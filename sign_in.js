const { JSDOM } = require('jsdom');
const loginUrl = 'https://teamkube.gss.com.tw/cas/login?service=https://gssportal.gss.com.tw/hrportal/ssologin.aspx';
const signinUrl = 'https://gssportal.gss.com.tw/HRPortal/Default.aspx';
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36';
require('tls').DEFAULT_MIN_VERSION = 'TLSv1'

let promise_request = (request, options) => {
    return new Promise((resolve, reject) => {
        request(options, (err, response) => {
            if (err) reject(err);
            resolve(response);
        });
    });
};

let login = (request, account, password) => {
    let options = {
        uri: loginUrl,
        headers: {
            'User-Agent': userAgent
        },
    }

    return promise_request(request, {
        ...options, 
    }).then((response) => {
        const { document } = (new JSDOM(response.body)).window;
        if (document.title === 'Smart Form 電子表單') {
            console.log(`${account} 已經登入過.`);
            return { response };
        }
        let lt = document.querySelector('input[name="lt"]').getAttribute('value');
        let host = document.querySelector('input[name="host"]').getAttribute('value');
        let eventId = document.querySelector('input[name="_eventId"]').getAttribute('value');
        return { lt, host, eventId, response };
    }).then((ssoOptions) => {
        if (!ssoOptions.lt) return ssoOptions.response;

        return promise_request(request, {
            ...options,
            method: 'post',
            form: {
                acUser: account,
                password: password,
                lt: ssoOptions.lt,
                host: ssoOptions.host,
                '_eventId': ssoOptions.eventId
            },
        }).catch((e) => {
            console.error(e);
            throw new Error('CAS 登入失敗');
        });
    }).then((response) => {
        const { document } = (new JSDOM(response.body)).window;
        if (document.title.trim() !== 'Smart Form 電子表單') {
            console.error(`${account} SSO 登入失敗`);
            throw new Error('login failed');
        } else {
            console.log(`${account} SSO 登入成功`);
        }
    }).catch((e) => {
        console.error(e);
        throw new Error('不知名錯誤。');
    });
};

let signin = (request, time) => {
    let options = {
        uri: signinUrl,
        headers: {
            'User-Agent': userAgent
        }
    };

    return promise_request(request, options).then(response => {
        const { document } = (new JSDOM(response.body)).window;
        let $viewState = document.querySelector('input[name="__VIEWSTATE"]');
        let $checkByTime = document.querySelector('input[name$="CheckInByTime"]');
        let $editText = document.querySelector('input[name$="$txtTime$EditText"]');
        let viewState = $viewState ? $viewState.getAttribute('value') : null;
        let widgetName = $checkByTime ? $checkByTime.getAttribute('name') : null;
        let timeAttributeName = $editText ? $editText.getAttribute('name') : null;
        let widgetX = widgetName + '.x';
        let widgetY = widgetName + '.y';
        let form = {
            'ScriptManager1': widgetName,
            '__VIEWSTATE': viewState,
            '__ASYNCPOST': true
        };
        if (!viewState) {
            console.error('input[name="__VIEWSTATE"] 取得失敗。');
            throw new Error('載入 Smart Form 電子表單發生錯誤。');
        }
        if (!widgetName) {
            console.error('input[name$="CheckInByTime"] 取得失敗。');
            throw new Error('載入 Smart Form 電子表單發生錯誤。');
        }
        if (!timeAttributeName) {
            console.error('input[name$="$txtTime$EditText"] 取得失敗。');
            throw new Error('載入 Smart Form 電子表單發生錯誤。');
        }
        form[widgetX] = 57;
        form[widgetY] = 64;
        form[timeAttributeName] = time;

        return promise_request(request, {
            ...options,
            method: 'post',
            form: form
        });
    }).then(response => {
        let reqex = /.*scriptStartupBlock\|ScriptContentNoTags\|alert\(\'(.*)\'\);.*/;
        if (!reqex.test(response.body)) {
            throw new Error('Smart Form 電子表單回應未預期。');
        }
        return reqex.exec(response.body)[1];
    }).catch((e) => {
        console.error(e);
        throw new Error(e);
    });
};

module.exports = {
    signin: (account, password, time) => {
        const request = require('request');
        const j = request.jar();
        const rq = request.defaults({ jar: j });
        return login(rq, account, password).then(signin.bind(null, rq, time));
    },
    login: (account, password) => {
        const request = require('request');
        const j = request.jar();
        const rq = request.defaults({ jar: j });
        return login(rq, account, password);
    }
}