const request = require('request');
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
        });
    }).then((response) => {
        const { document } = (new JSDOM(response.body)).window;
        if (document.title !== 'Smart Form 電子表單') {
            console.error('SSO 登入失敗');
            throw new Error('login failed');
        } else {
            console.log('SSO 登入成功');
        }
    }).catch(console.error);
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
        let viewState = document.querySelector('input[name="__VIEWSTATE"]').getAttribute('value');
        let widgetName = document.querySelector('input[name$="CheckInByTime"]').getAttribute('name');
        let timeAttributeName = document.querySelector('input[name$="$txtTime$EditText"]').getAttribute('name');
        let widgetX = widgetName + '.x';
        let widgetY = widgetName + '.y';
        let form = {
            'ScriptManager1': widgetName,
            '__VIEWSTATE': viewState,
            '__ASYNCPOST': true
        };
        if (!viewState || !widgetName) throw new Error('Smart Form 錯誤');
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
            throw new Error('打卡失敗');
        }
        return reqex.exec(response.body)[1];
    }).catch(console.error);
};

exports = {
    signin: (account, password, time) => {
        let rq = request.defaults({ jar: true });
        return login(rq, account, password).then(signin.bind(null, rq, time));
    },
    login: (account, password) => {
        let rq = request.defaults({ jar: true });
        return login(rq, account, password);
    }
}