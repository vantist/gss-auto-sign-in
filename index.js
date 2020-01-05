'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const cron = require('node-cron');
const signin = require('./sign_in.js');
const request = require('request');
const bodyParser = require('body-parser');

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
  pingServer: process.env.PING_TARGET_SERVER
};

let userMaps = {};

// create LINE SDK client
const client = new line.Client(config);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// static files
app.use('/liff', express.static('liff'));

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/callback', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

app.get('/ping', (req, res) => {
  res.send('done');
});

app.post('/setting', bodyParser.urlencoded({ extended: true }), (req, res) => {
  if (!req.body.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  if (!req.body.account) {
    res.status(500).send('account is empty.');
    return;
  }
  if (!req.body.password) {
    res.status(500).send('password is empty.');
    return;
  }

  signin.login(req.body.account, req.body.password).then(() => {
    userMaps[req.body.userId] = {
      account: req.body.account, 
      password: req.body.password
    }
    res.sendStatus(200);
  }).catch(() => {
    res.sendStatus(500);
  });
});

app.get('/setting', (req, res) => {
  if (!req.query.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  res.send(userMaps[req.query.userId]);
});

app.get('/signin', (req, res) => {
  if (!req.query.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  if (!req.query.time) {
    res.status(500).send('time is empty.');
    return;
  }
  let user = userMaps[req.query.userId];
  signin.signin(user.account, user.password, req.query.time).then(response => {
    res.send(response);
  }).catch(e => {
    res.status(500).send(e);
  });
});

// event handler
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  let userId = event.source.userId;
  let text = event.message.text;

  if (!userMaps[userId]) {
    userMaps[userId] = {};
  }

  if (text.indexOf('account:') === 0) {
    userMaps[userId].account = text.replace('account:', '').trim();
    let reply = { type: 'text', text: '已設定帳號: ' + userMaps[userId].account };
    return client.replyMessage(event.replyToken, reply);
  } else if (text.indexOf('password:') === 0) {
    userMaps[userId].password = text.replace('password:', '').trim();
    let reply = { type: 'text', text: '已設定密碼' };
    return client.replyMessage(event.replyToken, reply);
  } else if (text === 'testlogin') {
    let user = userMaps[userId];
    if (!user || !user.account) {
      let reply = { type: 'text', text: '未設定帳號' };
      return client.replyMessage(event.replyToken, reply);
    } else if (!user || !user.password) {
      let reply = { type: 'text', text: '未設定密碼' };
      return client.replyMessage(event.replyToken, reply);
    }

    signin.login(user.account, user.password).then(() => {
      let reply = { type: 'text', text: '登入成功' };
      return client.replyMessage(event.replyToken, reply);
    }).catch(e => {
      let reply = { type: 'text', text: '登入失敗: ' + e };
      return client.replyMessage(event.replyToken, reply);
    });
  } else if (text === 'signin') {
    let user = userMaps[userId];
    if (!user || !user.account) {
      let reply = { type: 'text', text: '未設定帳號' };
      return client.replyMessage(event.replyToken, reply);
    } else if (!user || !user.password) {
      let reply = { type: 'text', text: '未設定密碼' };
      return client.replyMessage(event.replyToken, reply);
    }

    let date = new Date();
    date.setTime(date.getTime() - 60000);
    let hour = `${date.getHours()}`.padStart(2, '0');
    let minute = `${date.getMinutes()}`.padStart(2, '0');
    let time = `${hour}${minute}`;

    signin.signin(user.account, user.password, time).then(response => {
      let reply = { type: 'text', text: response };
      return client.replyMessage(event.replyToken, reply);
    }).catch(e => {
      let reply = { type: 'text', text: '打卡失敗: ' + e };
      return client.replyMessage(event.replyToken, reply);
    });
  } else if (text === 'testcron') {
    let reply = { type: 'text', text: '開始自動打卡測試' };
    autoSignIn();
    return client.replyMessage(event.replyToken, reply);
  } else {
    let reply = { type: 'text', text: 'help:\n設定帳號 account:xxxx\n設定密碼 password:xxx\n測試帳號連線 testlogin\n立即打卡 signin'};
    return client.replyMessage(event.replyToken, reply);
  }
}

let getRandom = (min, max) => {
  return Math.floor(Math.random()*max)+min;
};

let autoSignIn = (test) => {
  Object.keys(userMaps).forEach(userId => {
    let offset = test ? 0 : getRandom(0, 20) * 60 * 1000;
    console.log(`enqeeue auto Sign In for ${userId} , wait ${offset} ms`);
    setTimeout(function(userId) {
      let user = userMaps[userId];
      let date = new Date();
      date.setTime(date.getTime() - 60000);
      let hour = `${date.getHours()}`.padStart(2, '0');
      let minute = `${date.getMinutes()}`.padStart(2, '0');
      let time = `${hour}${minute}`;

      if (!(user && user.account && user.password)) {
        return;
      }

      console.log(`auto Sign In for ${user.account}`);
      signin.signin(user.account, user.password, time).then(response => {
        let reply = { type: 'text', text: response };
        client.pushMessage(userId, reply);
      }).catch(e => {
        let reply = { type: 'text', text: '打卡失敗: ' + e };
        client.pushMessage(userId, reply);
      });
    }.bind(null, userId), offset);
  });
};

// listen on port
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});

cron.schedule('0 30 8 * * 1-5', () => {
  console.log('執行自動上班打卡');
  autoSignIn();
});

cron.schedule('0 30 17 * * 1-5', () => {
  console.log('執行自動下班打卡');
  autoSignIn();
});

cron.schedule('0 */10 * * * *', () => {
  console.log(`auto ping to ${config.pingServer}`);
  request.get(config.pingServer, {}, (err, response) => {
    console.log(`auto ping to ${config.pingServer} done`);
  });
});