// ==UserScript==
// @name         电影评分集成器 (豆瓣、IMDb、烂番茄、Metacritic)
// @name:en      Movie Rating Integrator (Douban, IMDb, Rotten Tomatoes, Metacritic)
// @name:zh-CN   电影评分集成器 (豆瓣、IMDb、烂番茄、Metacritic)
// @namespace    https://github.com/x-ww/MovieRatingIntegrator
// @version      1.0
// @description  在豆瓣、IMDb网站上集成显示来自多个平台（IMDb、豆瓣、烂番茄、Metacritic）的电影评分和信息，帮助你更全面地了解电影评价。
// @description:en Shows integrated movie ratings from multiple platforms (IMDb, Douban, Rotten Tomatoes, Metacritic) on Douban and IMDb websites to provide a comprehensive view of movie evaluations.
// @description:zh-CN 在豆瓣、IMDb网站上集成显示来自多个平台（IMDb、豆瓣、烂番茄、Metacritic）的电影评分和信息，帮助你更全面地了解电影评价。
// @author       x-ww
// @match        *://movie.douban.com/subject/*
// @match        *://www.douban.com/personage/*
// @match        *://www.imdb.com/title/*
// @connect      api.douban.com
// @connect      movie.douban.com
// @connect      www.omdbapi.com
// @connect      p.media-imdb.com
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @homepageURL  https://github.com/x-ww/MovieRatingIntegrator
// @supportURL   https://github.com/x-ww/MovieRatingIntegrator/issues
// ==/UserScript==
'use strict';

(() => {
    // Helper function to perform GM.xmlHttpRequest and return a Promise
    function getURL_GM(url, headers, data) {
        return new Promise(resolve => {
            GM.xmlHttpRequest({
                method: data ? 'POST' : 'GET',
                url: url,
                headers: headers,
                data: data,
                onload: response => {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response.responseText);
                    } else {
                        console.error(`Error getting ${url}:`, response.status, response.statusText, response.responseText);
                        resolve();
                    }
                },
                onerror: response => {
                    console.error(`Error during GM.xmlHttpRequest to ${url}:`, response.statusText);
                    resolve();
                }
            });
        });
    }

    // Helper function to fetch and parse JSON data using GM.xmlHttpRequest
    async function getJSON_GM(url, headers, post_data) {
        const data = await getURL_GM(url, headers, post_data);
        if (data) {
            try {
                return JSON.parse(data);
            } catch (e) {
                console.error(`Error parsing JSON from ${url}:`, e);
            }
        }
    }

    // Helper function to fetch and parse JSONP data using GM.xmlHttpRequest
    async function getJSONP_GM(url, headers, post_data) {
        const data = await getURL_GM(url, headers, post_data);
        if (data) {
            try {
                const end = data.lastIndexOf(')');
                const [, json] = data.substring(0, end).split('(', 2);
                return JSON.parse(json);
            } catch(e) {
                console.error(`Error parsing JSONP from ${url}:`, e);
            }
        }
    }

    // Helper function to fetch and parse JSON data using fetch API
    async function getJSON(url) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
            console.error(`Error fetching ${url}:`, response.status, response.statusText, await response.text());
        } catch (e) {
            console.error(`Error fetching ${url}:`, e);
        }
    }

    // Checks if a string is null, undefined, or 'N/A'
    const isEmpty = s => !s || s === 'N/A';

    // Fetches movie information from IMDb via OMDb API and IMDb's own ratings API
    async function getIMDbInfo(id) {
        const keys = ['40700ff1', '4ee790e0', 'd82cb888', '386234f9', 'd58193b6', '15c0aa3f'];
        const apikey = keys[Math.floor(Math.random() * keys.length)];
        const omdbapi_url = `https://www.omdbapi.com/?tomatoes=true&apikey=${apikey}&i=${id}`;
        const imdb_url = `https://p.media-imdb.com/static-content/documents/v1/title/${id}/ratings%3Fjsonp=imdb.rating.run:imdb.api.title.ratings/data.json`;

        let [omdb_data, imdb_data] = await Promise.all([getJSON(omdbapi_url), getJSONP_GM(imdb_url)]);
        omdb_data = omdb_data || {};

        if (imdb_data?.resource) {
            const { resource } = imdb_data;
            if (resource.rating) omdb_data.imdbRating = resource.rating;
            if (resource.ratingCount) omdb_data.imdbVotes = resource.ratingCount;
            if (resource.ratingsHistograms?.["IMDb Users"]) {
                omdb_data.histogram = resource.ratingsHistograms["IMDb Users"].histogram;
            }
            if (resource.topRank) omdb_data.topRank = resource.topRank;
        }
        return omdb_data;
    }

    // Fetches movie information from Douban's API
    async function getDoubanInfo(id) {
        const doubanAPI = async query => await getJSON_GM(`https://api.douban.com/v2/${query}`, { "Content-Type": "application/x-www-form-urlencoded; charset=utf8" }, "apikey=0ab215a8b1977939201640fa14c66bab");

        let data = await doubanAPI(`movie/imdb/${id}`);
        if (data && !isEmpty(data.alt)) {
            const url = data.alt.replace('/movie/', '/subject/') + '/';
            return { url, rating: data.rating, title: data.title };
        }

        // Fallback to search if direct lookup fails
        const search = await getJSON_GM(`https://movie.douban.com/j/subject_suggest?q=${id}`);
        if (search?.[0]?.id) {
            const abstract = await getJSON_GM(`https://movie.douban.com/j/subject_abstract?subject_id=${search[0].id}`);
            const average = abstract?.subject?.rate || '?';
            return {
                url: `https://movie.douban.com/subject/${search[0].id}/`,
                rating: { numRaters: '', max: 10, average },
                title: search[0].title,
            };
        }
    }

    // --- DOM Manipulation Functions ---

    function insertDoubanRatingDiv(parent, title, rating, link, num_raters, histogram) {
        let star = (5 * Math.round(rating)).toString().padStart(2, '0');
        if (typeof rating === 'number') rating = rating.toFixed(1);

        let histogram_html = '';
        if (histogram) {
            histogram_html += '<div class="ratings-on-weight">';
            const max = Math.max(...Object.values(histogram));
            for (let i = 10; i > 0; i--) {
                const percent = (histogram[i] * 100 / num_raters).toFixed(1);
                histogram_html += `
                    <div class="item">
                        <span class="stars${i} starstop" style="width:18px;text-align:center">${i}</span>
                        <div class="power" style="width:${64 / max * histogram[i]}px"></div>
                        <span class="rating_per">${percent}%</span><br>
                    </div>`;
            }
            histogram_html += '</div>';
        }

        parent.insertAdjacentHTML('beforeend', `
            <div class="rating_logo">${title}</div>
            <div class="rating_self clearfix">
                <strong class="ll rating_num">${rating}</strong>
                <div class="rating_right">
                    <div class="ll bigstar${star}"></div>
                    <div style="clear: both" class="rating_sum">
                        <a href=${link} target=_blank>${num_raters.toString().replace(/,/g, '')}人评价</a>
                    </div>
                </div>
            </div>${histogram_html}`);
    }

    function insertDoubanInfo(name, value) {
        const info = document.querySelector('#info');
        if (info) {
            if (info.lastElementChild?.nodeName !== 'BR') info.insertAdjacentHTML('beforeend', '<br>');
            info.insertAdjacentHTML('beforeend', `<span class="pl">${name}:</span> ${value}<br>`);
        }
    }

    function linkifyNode(text_node, url_base) {
        const id = text_node.textContent.trim();
        if(!id) return null;
        const a = document.createElement('a');
        a.href = url_base + id;
        a.target = '_blank';
        a.textContent = id;
        text_node.replaceWith(a);
        a.insertAdjacentText('beforebegin', ' ');
        return id;
    }

    // --- Main Logic ---

    const host = location.hostname;

    if (host === 'movie.douban.com') {
        let sectl = document.getElementById('interest_sectl');
        if (!sectl) {
            // Attempt to recover censored rating section
            const douban_id = location.href.match(/douban\.com\/subject\/(\d+)/)?.[1];
            if (!douban_id) return;

            const subjectwrap = document.querySelector('.subjectwrap');
            const subject = document.querySelector('.subject');
            if (!subjectwrap || !subject) return;

            sectl = document.createElement('div');
            sectl.id = 'interest_sectl';
            subjectwrap.insertBefore(sectl, subject.nextSibling);
            const rating_wrap = document.createElement('div');
            rating_wrap.className = 'rating_wrap';
            sectl.appendChild(rating_wrap);

            getDoubanInfo(douban_id).then(data => {
                if (data?.rating && !isEmpty(data.rating.average)) {
                    insertDoubanRatingDiv(rating_wrap, '豆瓣评分', data.rating.average, `https://movie.douban.com/subject/${douban_id}/collections`, data.rating.numRaters);
                    rating_wrap.title = 'Rating recovered by script.';
                }
            });
            if (document.querySelector('#movie-rating-iframe')) sectl.style.marginTop = '96px';
        }

        const imdb_text_node = [...document.querySelectorAll('#info > span.pl')].find(s => s.innerText.trim() === 'IMDb:')?.nextSibling;
        if (!imdb_text_node) return;

        const imdb_id = linkifyNode(imdb_text_node, 'https://www.imdb.com/title/');
        if (!imdb_id) return;

        getIMDbInfo(imdb_id).then(data => {
            if (!data || (isEmpty(data.imdbRating) && isEmpty(data.Metascore))) return;

            const ratings = document.createElement('div');
            ratings.style.cssText = 'padding: 15px 0; border-top: 1px solid #eaeaea;';
            ratings.className = 'rating_wrap clearbox';

            let rating_wrap = document.querySelector('.friends_rating_wrap') || document.querySelector('.rating_wrap');
            sectl.insertBefore(ratings, rating_wrap.nextSibling);

            // Adjust layout to reduce whitespace
            sectl.style.marginBottom = document.querySelector('.colbutt') ? '-136px' : '-154px';
            const rec_sec = document.querySelector('.rec-sec, #interest_sect_level');
            if (rec_sec) rec_sec.style.width = '488px';

            // Display IMDb Rating
            if (!isEmpty(data.imdbRating)) {
                insertDoubanRatingDiv(ratings, 'IMDb评分', data.imdbRating, `https://www.imdb.com/title/${imdb_id}/ratings`, data.imdbVotes, data.histogram);
                if (!isEmpty(data.topRank) && data.topRank <= 250) {
                    const style = document.createElement('style');
                    style.innerHTML = '.top250{background:url(https://img1.doubanio.com/f/movie/f8a7b5e23d00edee6b42c6424989ce6683aa2fff/pics/movie/top250_bg.png) no-repeat;width:150px;font:12px Helvetica,Arial,sans-serif;margin:5px 0;color:#744900;display:inline-block}.top250 span{display:inline-block;text-align:center;height:18px;line-height:18px}.top250 a{color:#744900;text-decoration:none;background:none}.top250-no{width:34%}.top250-link{width:66%}';
                    document.head.appendChild(style);
                    (document.getElementById('dale_movie_subject_top_icon') || document.querySelector('h1')).insertAdjacentHTML('beforebegin', `<div class="top250"><span class="top250-no">No.${data.topRank}</span><span class="top250-link"><a href="https://www.imdb.com/chart/top">IMDb Top 250</a></span></div>`);
                }
            }

            // Display Metascore
            if (!isEmpty(data.Metascore)) {
                const metascore = parseInt(data.Metascore);
                let metacolor = '#f00';
                if (metascore >= 60) metacolor = '#6c3';
                else if (metascore >= 40) metacolor = '#fc3';

                // 生成 Metacritic slug，修正罗马数字为阿拉伯数字
                let metaUrl = '';
                if (data.Title) {
                    let slug = data.Title.toLowerCase()
                        .replace(/[:'".,?!&]/g, '') // 去除特殊符号
                        .replace(/[\s_]+/g, '-')    // 空格/下划线转为-
                        .replace(/-+/g, '-')        // 多个-合并
                        .replace(/[^a-z0-9-]/g, '') // 只保留字母数字和-
                        .replace(/^-+|-+$/g, '');   // 去除首尾-
                    // 罗马数字结尾转阿拉伯数字（常见2-10）
                    slug = slug.replace(/-(ii|iii|iv|v|vi|vii|viii|ix|x)$/, function(_, roman) {
                        const map = {ii:'2',iii:'3',iv:'4',v:'5',vi:'6',vii:'7',viii:'8',ix:'9',x:'10'};
                        return '-' + map[roman];
                    });
                    metaUrl = `https://www.metacritic.com/movie/${slug}/`;
                } else {
                    // 兜底用片名搜索
                    const title = document.querySelector('h1')?.textContent.trim() || document.title.replace(/ - 豆瓣.*$/, '').replace(/（.*/, '').trim();
                    metaUrl = `https://www.metacritic.com/search/all/${encodeURIComponent(title)}/results`;
                }

                ratings.insertAdjacentHTML(
                    'beforeend',
                    `<br>Metascore: <a href="${metaUrl}" target="_blank" style="text-decoration:none">
                        <span style="background-color:${metacolor};color:#fff;height:24px;width:24px;line-height:24px;vertical-align:middle;display:inline-block;text-align:center;font-weight:bold">${data.Metascore}</span>
                    </a>`
                );
            }

            // Display Rotten Tomatoes
            const tomatoRating = data.Ratings?.find(r => r.Source === 'Rotten Tomatoes');
            if (tomatoRating?.Value) {
                const tomatoImages = {
                    fresh: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAFBElEQVR4Aa2VA7TszBpEd6c7yfiY13q2bdu2bdu2bdu2bdtHGGei7u9l8Ju4tVaNsKtaieJsyA917djNjrzk9z/a/hzwKc6BDGdDpbo/e3i1es3NYPtrrX+1K0B0XAI8rUJtvKA6E+6J/9XV57/I9PX/mGX/A77D2ZQ6xRuFBzgAE+r6ngvO3ODoFVfuV58LyvZPvSs1zt+wP/3W/56YRPnuf3698xGgc45GIChvam/1KqsXnLnYwQvN3nTPhWeulXStIXO0kjb/+vh/zEVue/AZUvPi1f8kgx+ttT8GJGd7BABTvlm5/NX3vlEuM3/TxaUSTdH8+7d9yv/oUGsY6pecJlguMb8z2M7/3Pvd5k+3Pv/DP+y8D/jXWQYESgXXPDh7p/lbHnhcfqh6QV02DFKo4fhnU6hVNIcWNO4fEUEno1sExg2fcGvw73984l8v/M5vN98CJKcbMOXpmdtecvWljasu3fNif4459p+UPx30+f6NF9ChR9bLiaqG0PeY++uA+759g1rHsjal+d2hkJ9dosLar7ff88Wv/euRwPYpAspKlZ+8uvzWix1o3PFyu5YlrSAsrODpt1vk9/tC7vyONbpW+MpN5hkcrnCjLzS5ywe2yX2FlwstDd89EvCTne6HX/aX/90DiE4MeHh95glPm5t7fqWqyBYNa4s+67OGv84FfPlgmUN/6/O4r7ao/zvn+0XjN99/menA48kv/C9hIuRG4TswuaPvK17YbT4NeDaAdwE/uPADGtMPV3VNuuwTzfv8YUbzw1mffxrFdX/X5cH/TPCXA9pHQq7Ycdzxg9sMrBCXNZ5jpMyDQRHqKcV9a1MP/fygf/HCmJuUardaDM2yqiqkoalO+1y3EXD9IMTzFH7FJ1tIiHQKqdCZN1z5rwl/+GWfqKKY3RUEheIkzXt64abl6q2BX5orh+Wr4wMlUKGCqoaZMt5CHVUyJO2EfLODF+dQUtgSeL7H5X4VQS6Id0o4gAOuGJavCWD2G3MIBSiFGAWeQrRGygGqXoIhWHuFx9+pwkkAB9YzlIJMn4SXCTxFmNFmH4ApKVXCAVYgH1uSDNcejJ/7KZLZwoLkbvw9inIuoECGhglCSIFYhIE4H8A0rdtdzlklFlQkSD9HBTHWOZTWSJpDO0H1LcQCiYCVERg1AU9aJwgRMED4n827AOZ3efLrC2bBRaQn2HaGNuDsMCxHlMLlDgq4a2fQdhAJOBA1BmeT1hHD1kJfHD3n+FUa/xbAfDmOPnvrSv2O0negwUqOShwq9MBTkDskLty20BRcIghCJpw0HQzBhZ2li9DKUr4fDz4zCeh/7odp/N3LB6Ur03GQgnQtEqoTA4hB+oIkQgYjeMKkNePWXWfp2Jx2nvHrOPrRr7Pk0wAK4CrFlnrX3MrHpjxvGgAP0JOvRRAL1o3hyaR1xLCxG8HbtoC7bNR8LYk7n8iy2wJfOsXF7o7Vxj1eOr3w+lCpEsJIMrKQAhlCDEQiI/ecK2xpuXHrVhKzlSXZ16x9MPDm071c36Rcu9XTp+ZecNj4xxyQTxYxnrTuU1gsPetonwDOEpppwj/z/G8/FnkS8MEzveEcMv7R+9amH3bdcuWWs57ZOxA32R1CT9x4ngu38rQAx/w3zf73B3Gf+BO8Cvjj6d9wTkdHjH+BS4Wla1zQhFde0PqCGuaK9n4zy9LNLGn+O0//8A/rvrsG3wB+xxno/+N5rMoDguFXAAAAAElFTkSuQmCC',
                    rotten: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAFZ0lEQVR4Ac1UA5Qj7RYMhwjGtk10upOsbTtr28YoM6uxbRtr29Zv22a9O3q265w6za+uwPtr0Jfo+npGWmuDBzsUmDmYTOYL+GLevwsSCwNmbVzQq02XGbRcZZBWF/VDgMoumc/ni/51dT5PMGK2e8uJ+yR+TYHGSyw6bjI4Uhn9i8zGaNi/rC/SEZqu14a+X3eRRWEnsYNFEV2zmxVwCTRf+fv/CsVCqaFcP5zS6ScQ8vX+qrCugdhW31jHpfvHiUt8LpWdYJHZqEBmgwLZTQoklSpg5Sqd1v+/qZ3xcM3G0GuZdWO+0BYM/yh0iFO+SFdo9mfFnfzMVmw7EvLGnszwDwKUtomWzpJpuzKivslq4nC4gkV6HYcFO0Le0zEQ2/MIBjK9wPXaqPcbLo6hGo3H2YfTUXFyAryibVP+RNzS0WRIZn3El513GFSeY5Fcx/5q7iSZbOYombJOG/nN0SolDpVzCB7kkNt/xj3Mam9KtZLqokRqjRpZTYNRc3Ykxi8JfC4QCoz/wECI0mpj01UFyk+zyGjhkNKoQuQo57Ie426yhTvSGRJRImK4U1FPjcRCySiN14XDFRwSilloiXRFer0KU9YEfUx1sfnD9PjI55SdYlByksORWhZJ5PHymIiPKYopcnuTieuTon44WsVhV2b096M1nicmL/O9ElvA/qIt5ZBUxuJgGaWxkkgRRY/1eEbz8ocRiPVEVpOW+1zKP9brfWwJBy0d2put+GVnGvNrQhGLeGJiCQvyGgeJ9B1JNSpoy5WIp/9jCllM3xAKmbXxvj8/tdQ9oUMcMpfFhn+SSIdIDIml5F05RwIs4sjb35LEY4hT14ciYqTHNz6MwzOXQOsrEkvDWPJewvtroC6xDVDbpx8oYn89VMshsYolT8nbavK8pptKpDQpsSE5Guau8nahjtCFz+cJe8bzr4EicLawN2KlFgbBFtSiW1Ijv87q4JDazCGtpY/NbM81o40MVzJQTHA7ae4snSqxMlLrmeh6UfcY/NnF4BxovnZ5TMhre3Iiv9qaFvHpgaLo7zNau0XZPnJIb+0mS+IsyDByqV5ZnQrElDDYmBL5w+xtQW+rpnlesPSQL/+DiZbbGY/clhb+Sd7xnoPE3mtmO4ucrl5vM0k0u5Mj0to4zaH8ghJVl1WouqRG3dXBaLk1DJ33RuH4gwlIrh4OP7VDqUDUF03wEMei5AYFCfaIEVnkHe8VyyCPS86qUHpWjfLzA9F4YyjiC5U/RI5wur5iT8T7px9NxenHM3DmyWycfzYXF15ocOe1xcisHQtbP/NtNO2hPEtX6ZyY4sivKy5wKD6jQs1lNfI6VVBO9bjoq7TPT6sf/N3Jx5Nw/P5UXH5pDtbsY94X6QlDdQzF0Zu0qvdvv7oYF19aiEsvLcD55wt6ruceaDBoms81O1/z/bzu/R400P5o0fEhaL89FmUnR4MZ59ZG3SEX6Yls1sYwL918ZSF5Nx/XX1mEmhNTYOko2csjWHuaripun4irLy9A15056LgxG81XZhCnY8zCwFfdI2xo8gnd+bJykU4KG+gQa+9lqhGKBEa9q1hgsmBz+PUbJHz2iQZnHmsoCg0mzA19nb65dDvHjHPvKOmaiOKuSUij1CRXjcburEHwYR0vmzlIdvH+FlQTPKpPPZiD1qszUHd+CkU5HbNWRf1I0z+gp72pPQfO8Lm3PFaBRfsZTN8agbCRbu/pGekMobY1/5sGTCwN1Uv2Mh/HFQ3r8WzO+mjYeZi108TKfn84bbzNdjr4W5abOUgTxboiP94/AjIyyD3KrtMl2OaWsZnBnh7P/p0QUcGltiarjC0MD4j1hNG8/yf8BrCAoJdN16WUAAAAAElFTkSuQmCC'
                };
                const fresh = parseInt(tomatoRating.Value) >= 60 ? 'fresh' : 'rotten';
                const tomato_url = data.tomatoURL.replace('http://', 'https://');
                ratings.insertAdjacentHTML('beforeend', `<br><a href="${tomato_url}" target="_blank" style="background:none"><span style="background:url(data:image/png;base64,${tomatoImages[fresh]}) no-repeat;background-size:cover;width:18px;height:18px;margin:0 2px;vertical-align:middle;display:inline-block"></span></a><span style="vertical-align:middle;display:inline-block;line-height:18px">${tomatoRating.Value}</span>`);

                if (!isEmpty(data.tomatoUserMeter)) {
                    const userImages = {
                        full: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAFK0lEQVR4AZTNQ4DsWAAF0JsXFJIygm/btm3btoXN2LZt27bRtm2nKprGdlr3mYegndA0ocMhV5gQilzdO+CmJ25c9uonL576dtwIaSLQEo/b4aUag/9Ju8CC2SMXvvP8kQ/uuW7Vfdu3bdkxdfLkWZNHKdPO7Z5288wJvRY8eOuORy4cmn4ZgNUpQJF8XWZM6DH7zMEFF7o52bFrZvQ53G/kVNnrZ4WqyiJj0crVM568afkbC4bZ9nf30SMH9vYM7TDg8/C+2y/NffiFOzZ8On6oNM0VFk04esLUSmCodfaKzDRaL/sFvoCd93Xvj5lzV8zZu2XCoQ4BTo7hH7pp3RMrlk9f6g0rdF3BP+AYjYS72VGUGgPG0hES/SgvZlBTrsGqL4TXU0sU0d6dt3N8m4AblOeOwd0fmT1JWuUMjQYIi/rKepSn/IyKrBgwQg9wPAOV6Ql/r/7wSjx0tQJ15dWYMm7IotsPL76Xp2mhVWC34D2y4uj0LXzXYdCqs2GoVRBHzIKnx1BUF1fBrImBFjUg9ekFWktDpLYCFiuDYRlYhKLnDnLt3m8XTrYKjAczla7gYA/2hIpy1FQVorqkGLSgINyrJyJVpYCpw2YzQTu6gqK8cCsKNLMIzpAXLkcAM3jHvFaBCEEDc9fnqNx9A7TPEsDWmjDqMgEOYCUFoVETUakZSE7JBngB4AREc9Nh/ZgG9sbPYLv6PqKa2dAqkMLR8XB5YL70O6wz74E++gmc1/6GyOnXoF33HYw7f4brmVgID/4I9fRLIOc+gLbrbXDXJUB7NgYmKyCGpf9qFUiHlSo8fDfI0H6wiAVU69C/y4P2bgzURz5Bwy3vgn74ezje/hvW+3HQv4gBVanDpCyQwb3geuRupFpmYqtAXl1NTtTnjRBZApFEuF9+GsL9N4MKCiDdJNj3bodt72ZYXYKAT2g8u63xzjMgsghalhAN+CK5tTU5rQIFqppXEBtbClEEGlQwo0bAcWAvYLM3IgEI99zW2O4AFQoBNq7prPHOyP8qK4cEWK4Aip42Y3tFyR5CDJNRsImY09j2t+2wzVJbVY+prmnQSfHp3vMEbBhiY4175dexE4bDfwRMYdKv1R3uvhOzXKA8H2MtqVwOKxUYk7wIBfl8EtZ+gFkssbGmX/vDmcL4HwELa+f9334fmttvwypJNJsjUylMoZjErbFYazBSYotFVDqNms0wSmBjTffX3wdbj3/bKsJWo97W112HtaCnUyRgSwWMUmhrURa01glAA2I6QxnLVtOp1zrA5t8A1Pv9miqXkPkCejzBAKZcTEz11sgatJLoUikB6MkUlSsgqxVqg/4fOze77mTSWksp1DVXI12PxKRYRmuJwiSQBBZDJSA8DxOXDYUQncm4uRMwULI38YOZufEGhOsiAV0uoZRBaoNKAApVKiKAyHFRcdlpMFoMpRzsBDgi6nmDgW/vuQfpeFjAlEoordFSIqVAJi0ooxOAA/fchT8ceI4QvZ2AhWXS/O67YD0eI6OQDKCvvZZIa1Q6g8pkENpgr7mWJC/cEE4m1L75NphZO9oJAKKfzp/73Dt5kmWrzeqzL5GLBWo7XZ0hdjjEpMAs5qzjvFWzjXfyFHvOn/sCiP4LgO/Wq9ffN+L5oF4T/UceZ/X9D6TSsHzgYRYPPJQA5j/8RPfRx/HjMh8Z+eK369Wr/+fQX705Dp58ehrc+7YMXz6wWR88G4U/n2+1m6earT+OhZuzezerve+J8JVnp8F9b4z9J4DV3xn9CYgbvHRBBzqoAAAAAElFTkSuQmCC',
                        spilled: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAEXklEQVR4Ae2UQ6MjWRiG33NOpVJIUhX7KpdtjW3btpfzG2Y9mxE2Y9tm27Z9jSRlTKaGbaz7LfP5jBM6kgiOQ5SCyxTFCeOnpa9L5sOtS2b2vw7gexxE3GHpFEwQOSUS4zOpjFpKZ5XmbE5tbatUWjip2gZhRw+ciBKLRcd/8/76YQALD+sBH2aR7smpyxvfd2Tz6VJzU1ux0trekkwlE+lkTpEkWTbtKtGMUSxa/wH29m3Gip+SsHSKbPeueW89t/JyAEMHBSTSQuW6+5tePfusc87oKJ0Lx7VQ1QYwPLYLo7VeaMYQdHMMrufAhw9BYujfImPl7zI8l6BtiubPn7PkTgBvHQAgBPS2J7o/PPW8wrXETsL3AI6FIAoKZFFBTM4iKmcgNc55TsacFW9i9+AibFqQwe6NPBgF5LgNHWtfBPDoPjkIiyxWaIpMa+4MnT2t63JMb38UPjzwnADWgOyvmjaE35a8ANsGasMMjPoglMDQGMS00PnF2xsUAKP/Alo6Yme19agXqaqY6O3rxXztUxjWGCy7Bt2swrQ12LYRbI5nw3bq0N29IE4EpkZAGAAgCBPxWJLjiLQPIF2QxmcL0kT4PFatmwutPhOUAoRQUMYQHAkJzhnh4MMGEz24dgi+R0EI4CPYAT4VKSP7uM01SjArRbhUrabjunOfQnvTGbBtG5RSMEIARkB8EkD4sIB122bhk9+ehO+GIIoyQHzADwBgjOcIAdsHYFtu3bY93bE89A/ugcRvhuvaoIwDoyzYaLBRCEIMtfoIPN8DYRxURQGhPnxQ+B6BSTkfjWUfQHXE2l0btXdnCyK+/vVpGIYZWEUaG0BAKQEJQkRBwMCFGGQlFHgkRRX4YKAE4BqgvjqxPM939gEM9hoblYTWUqpwmDHpBkysXIKRai8MqwbTqsO2dZh2HYb5Z+J1GNYoeodXgcLGxHYeYeZAtxXsHCLQBrQR1/GNfQDbN47NMgyn2j4+fJ9ujGQkMYGonIYgRMCHJHCcEPQECEGIA6q1Pjz79r0Yre3E2VNGkRHqsHgev65T4Lqt2rd0g3XQTr705uaXuyZGH5T4JCgNwXHNv5stCllqQKUkVKUQHOev+BBbdy3Hw1fciS41jj2bF4AQAeFkS+/Fd794NoD1+Fv/ZnzXlvpsQUa+p3ty1xnTb2PlwkSSTVQg8BEYZg39Q9uweccCrNn4E+raACyXQIaBKc05REsTURvYiWg8JYyf0Fnp7xvEgqVbN45VdYfsO4YJpyb5rkxO6Sw3FdtLTbm2YqnU1N7W1dwYd4lYLK6KgiQ2QomvZ74Es7oV906ahpbWqUDYgM8SQSn7zgC+XUA++fHXxT+Qo5n9gsipUYXPp9JqUyIdbS2VcxXGG20O65vQU0hHWtTSxrOnTu+CuUsaHBrarVaupG99OPPNWXOXzyI4ToVFFm/rjF1BeGRH99o/P3DLRVcrvB6fu3DtPCtU1mbNXTFzeGRsGCd0JP0BLHO0MJZ4Kw0AAAAASUVORK5CYII='
                    };
                    const userImage = parseFloat(data.tomatoUserRating) >= 3.5 ? 'full' : 'spilled';
                    ratings.insertAdjacentHTML('beforeend', `<a href="${tomato_url}" target="_blank" style="background:none"><span style="background:url(data:image/png;base64,${userImages[userImage]}) no-repeat;background-size:cover;width:18px;height:18px;margin:0 2px;vertical-align:middle;display:inline-block"></span></a><span style="vertical-align:middle;display:inline-block;line-height:18px">${data.tomatoUserMeter}%</span>`);
                }
            }

            if (!isEmpty(data.Rated)) insertDoubanInfo('MPAA评级', data.Rated);
            if (!isEmpty(data.BoxOffice)) insertDoubanInfo('票房', data.BoxOffice);
        });

    } else if (host === 'www.douban.com') { // For person pages
        const person_id_node = [...document.querySelectorAll('span.value')].find(s => s.innerText.trim().match(/^nm\d+/));
        if (person_id_node) linkifyNode(person_id_node, 'https://www.imdb.com/name/');

    } else if (host === 'www.imdb.com') {
        const id_match = location.href.match(/tt\d+/);
        if (!id_match) return;
        const id = id_match[0];

        getDoubanInfo(id).then(data => {
            if (!data) return;
            const imdb_rating = document.querySelector('.rating-bar__base-button');
            if (!imdb_rating) return;

            const douban_rating = imdb_rating.cloneNode(true);
            douban_rating.firstElementChild.textContent = 'Douban RATING';
            douban_rating.href = data.url;
            douban_rating.target = '_blank';
            douban_rating.title = data.title;

            const rating_div = douban_rating.querySelector('div[data-testid="hero-rating-bar__aggregate-rating__score"]');
            rating_div.firstElementChild.textContent = data.rating.average;

            const numRatersElement = rating_div.nextElementSibling.nextElementSibling;
            if (numRatersElement) {
                 numRatersElement.textContent = new Intl.NumberFormat("en-US", { notation: 'compact' }).format(data.rating.numRaters);
            }

            // 修复跳转问题：阻止默认事件并手动跳转
            douban_rating.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                window.open(data.url, '_blank');
            });

            imdb_rating.parentElement.insertAdjacentElement('afterbegin', douban_rating);
        });

    }
})();
