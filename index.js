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
  pingServer: process.env.PING_TARGET_SERVER,
  goWorkMorningCron: process.env.GO_WORK_MONRING_CRON || '0 0 9 * * 1-5',
  offWorkMorningCron: process.env.OFF_WORK_MONRING_CRON || '0 0 12 * * 1-5',
  goWorkAfternoonCron: process.env.GO_WORK_AFTERNOON_CRON || '0 30 12 * * 1-5',
  offWorkAfternoonCron: process.env.OFF_WORK_AFTERNOON_CRON || '0 0 18 * * 1-5',
  resetWorkStateCron: process.env.RESET_WORK_STATE_CRON || '0 0 0 * * 1-5',
};

/**
 * user {
 *   account: String,
 *   password: String,
 *   workMorning: Boolean,
 *   workAfternoon: Boolean
 * }
 */
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

app.post('/setting', bodyParser.json(), (req, res) => {
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
      password: req.body.password,
      workMorning: true,
      workAfternoon: true
    }
    let reply = { type: 'text', text: `${req.body.account} 帳號綁定成功` };
    client.pushMessage(req.body.userId, reply);
    res.sendStatus(200);
  }).catch(() => {
    delete userMaps[req.body.userId];
    let reply = { type: 'text', text: `帳號綁定失敗，${req.body.account} 登入測試發生錯誤` };
    client.pushMessage(req.body.userId, reply);
    res.status(500).send('login test failed');
  });
});

app.get('/setting', (req, res) => {
  if (!req.query.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  res.send(userMaps[req.query.userId]);
});

app.post('/cancel', (req, res) => {
  if (!req.body.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  if (userMaps[req.body.userId]) {
    delete userMaps[req.body.userId];
    let reply = { type: 'text', text: '帳號取消綁定成功' };
    client.pushMessage(req.body.userId, reply);
    res.sendStatus(200);
  } else {
    let reply = { type: 'text', text: '帳號取消綁定失敗' };
    client.pushMessage(req.body.userId, reply);
    res.sendStatus(500);
  }
});

app.post('/reset', (req, res) => {
  if (!req.body.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  if (userMaps[req.body.userId]) {
    userMaps[req.body.userId].workMorning = true;
    userMaps[req.body.userId].workAfternoon = true;
    let reply = { type: 'text', text: '重置請假狀態成功' };
    client.pushMessage(req.body.userId, reply);
    res.sendStatus(200);
  } else {
    let reply = { type: 'text', text: '重置請假狀態失敗' };
    client.pushMessage(req.body.userId, reply);
    res.sendStatus(500);
  }
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

  if (text === '登入測試') {
    let user = userMaps[userId];
    if (!checkAccountPassword(userId, event.replyToken)) return;

    signin.login(user.account, user.password).then(() => {
      let reply = { type: 'text', text: '登入成功' };
      return client.replyMessage(event.replyToken, reply);
    }).catch(e => {
      let reply = { type: 'text', text: '登入失敗: ' + e };
      return client.replyMessage(event.replyToken, reply);
    });
  } else if (text === '打卡') {
    let user = userMaps[userId];
    if (!checkAccountPassword(userId, event.replyToken)) return;

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
  } else if (text === '請整天') {
    let user = userMaps[userId];
    if (!checkAccountPassword(userId, event.replyToken)) return;
    user.workMorning = false;
    user.workAfternoon = false;
    let reply = { type: 'text', text: '已標記請整天，今天將不自動打卡' };
    return client.replyMessage(event.replyToken, reply);
  } else if (text === '請早上') {
    let user = userMaps[userId];
    if (!checkAccountPassword(userId, event.replyToken)) return;
    user.workMorning = false;
    user.workAfternoon = true;
    let reply = { type: 'text', text: '已標記請早上，今天早上將不自動打卡' };
    return client.replyMessage(event.replyToken, reply);
  } else if (text === '請下午') {
    let user = userMaps[userId];
    if (!checkAccountPassword(userId, event.replyToken)) return;
    user.workMorning = true;
    user.workAfternoon = false;
    let reply = { type: 'text', text: '已標記請下午，今天下午將不自動打卡' };
    return client.replyMessage(event.replyToken, reply);
  } else {
    let reply = { type: 'text', text: `help：\n測試帳號連線：測試登入\n立即打卡：打卡\n或使用選單功能。`};
    return client.replyMessage(event.replyToken, reply);
  }
}

let checkAccountPassword = (userId, replyToken) => {
  let user = userMaps[userId];
  if (!user || !user.account) {
    let reply = { type: 'text', text: '未設定帳號' };
    client.replyMessage(replyToken, reply);
    return false;
  } else if (!user || !user.password) {
    let reply = { type: 'text', text: '未設定密碼' };
    client.replyMessage(replyToken, reply);
    return false;
  }
  return true;
};

let getRandom = (min, max) => {
  return Math.floor(Math.random()*max)+min;
};

let autoSignIn = (isMorning) => {
  Object.keys(userMaps).forEach(userId => {
    let offset = getRandom(0, 20) * 60 * 1000;
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

      if (!user.workMorning && isMorning) {
        let reply = { type: 'text', text: '早上已標記請假，不自動打卡' };
        client.pushMessage(userId, reply);
        return;
      }

      if (!user.workAfternoon && !isMorning) {
        let reply = { type: 'text', text: '下午已標記請假，不自動打卡' };
        client.pushMessage(userId, reply);
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

cron.schedule(config.goWorkMorningCron, () => {
  console.log('執行早上自動上班打卡');
  autoSignIn(true);
});

cron.schedule(config.offWorkMorningCron, () => {
  console.log('執行早上自動下班打卡');
  autoSignIn(true);
});

cron.schedule(config.goWorkAfternoonCron, () => {
  console.log('執行下午自動上班打卡');
  autoSignIn(false);
});

cron.schedule(config.offWorkAfternoonCron, () => {
  console.log('執行下午自動下班打卡');
  autoSignIn(false);
});

cron.schedule(config.resetWorkStateCron, () => {
  console.log('重置請假狀態');
  Object.keys(userMaps).forEach(userId => {
    let user = userMaps[userId];
    console.log(`重置 ${user.account} 的請假狀態`);
    user.workMorning = true;
    user.workAfternoon = true;
  });
});

cron.schedule('0 */10 * * * *', () => {
  console.log(`auto ping to ${config.pingServer}`);
  request.get(config.pingServer, {}, (err, response) => {
    console.log(`auto ping to ${config.pingServer} done`);
  });
});