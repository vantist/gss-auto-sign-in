'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const cron = require('node-cron');
const signin = require('./sign_in.js');

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

let userMaps = {};

// create LINE SDK client
const client = new line.Client(config);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

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
        
// event handler
function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // ignore non-text-message event
    return Promise.resolve(null);
  }

  let userId = event.source.userId;
  let text = event.message.text;

  if (text.indexOf('account:') === 0) {
    userMaps[userId].account = text.replace('account:', '').trim();
    let reply = { type: 'text', text: '已設定帳號: ' + userMaps[userId].account };
    return client.replyMessage(event.replyToken, reply);
  } else if (text.indexOf('password:') === 0) {
    userMaps[userId].account = text.replace('password:', '').trim();
    let reply = { type: 'text', text: '已設定密碼'};
    return client.replyMessage(event.replyToken, reply);
  } else if (text === 'testlogin') {
    let user = userMaps[userId];
    if (!user.account) {
      let reply = { type: 'text', text: '未設定帳號'};
      return client.replyMessage(event.replyToken, reply);
    } else if (!user.password) {
      let reply = { type: 'text', text: '未設定密碼'};
      return client.replyMessage(event.replyToken, reply);
    }

    signin.login(user.account, user.password).then(() => {
      let reply = { type: 'text', text: '登入成功'};
      return client.replyMessage(event.replyToken, reply);
    }).catch(e => {
      let reply = { type: 'text', text: '登入失敗: ' + e};
      return client.replyMessage(event.replyToken, reply);
    });
  } else if (text === 'signin') {
    let user = userMaps[userId];
    if (!user.account) {
      let reply = { type: 'text', text: '未設定帳號'};
      return client.replyMessage(event.replyToken, reply);
    } else if (!user.password) {
      let reply = { type: 'text', text: '未設定密碼'};
      return client.replyMessage(event.replyToken, reply);
    }

    let date = new Date();
    let hour = `${date.getHours()}`.padStart(2, '0');
    let minute = `${date.getMinutes()}`.padStart(2, '0');
    let time = `${hour}${minute}`;

    signin.signin(user.account, user.password, time).then(response => {
      let reply = { type: 'text', text: response};
      return client.replyMessage(event.replyToken, reply);
    }).catch(e => {
      let reply = { type: 'text', text: '打卡失敗: ' + e};
      return client.replyMessage(event.replyToken, reply);
    });
  } else {
    let reply = { type: 'text', text: 'help:\n設定帳號 account:xxxx\n設定密碼 password:xxx\n測試帳號連線 testlogin\n立即打卡 signin'};
    return client.replyMessage(event.replyToken, reply);
  }
}

// listen on port
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});

cron.schedule('* 30 8 * * 1-5', () => {
  console.log('執行上班打卡');
});

cron.schedule('* 30 17 * * 1-5', () => {
  console.log('執行下班打卡');
});