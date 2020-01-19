'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const signin = require('./sign_in.js');
const bodyParser = require('body-parser');
const firebase = require('firebase/app');
const https = require('https');
const fs = require('fs');
require('firebase/database');

// create LINE SDK config from env variables
const config = {
  enablePushMessages: !!process.env.ENABLE_PUSH_MESSAGES,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
  },
  credentials: {
    cert: process.env.CERT_PATH,
    key: process.env.PRIVATE_KEY_PATH,
    ca: process.env.CA_PATH,
  },
};

/**
 * user {
 *   account: String,
 *   password: String,
 *   workMorning: Boolean,
 *   workAfternoon: Boolean
 * }
 */

firebase.initializeApp(config.firebase);
// Get a reference to the database service
const database = firebase.database();

// create LINE SDK client
const client = new line.Client(config);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// static files
app.use('/liff', express.static(__dirname + '/liff'));

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

app.get('/action', (req, res) => {
  let type = req.query.type;

  switch (type) {
    case 'goWorkMorning':
      console.log('執行早上自動上班打卡');
      autoSignIn(true, false);
      res.sendStatus(200);
      break;
    case 'goWorkAfternoon':
      console.log('執行下午自動上班打卡');
      autoSignIn(false, false);
      res.sendStatus(200);
      break;
    case 'offWorkMorning':
      console.log('執行早上自動下班打卡');
      autoSignIn(true, true);
      res.sendStatus(200);
      break;
    case 'offWorkAfternoon':
      console.log('執行下午自動下班打卡');
      autoSignIn(false, true);
      res.sendStatus(200);
      break;
    case 'resetWorkState':
      console.log('重置請假狀態');
      resetWorkState();
      res.sendStatus(200);
      break;
    default: 
      res.status(500);
      break;
  }
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

  signin.login(req.body.account, req.body.password)
    .then(saveUser.bind(null, req.body.userId, {
      account: req.body.account, 
      password: req.body.password,
      workMorning: true,
      workAfternoon: true
    })).then(() => ({ status: 200, message: `${req.body.account} 帳號綁定成功` }))
    .catch(() => {
      return deleteUser(req.body.userId)
        .then(() => ({ status: 500, message: `帳號綁定失敗，${req.body.account} 登入測試發生錯誤` }))
        .catch(e => ({ status: 500, message: `帳號綁定失敗，${req.body.account} 登入測試發生錯誤` }));
    }).then(data => {
      pushMessage(req.body.userId, data.message);
      res.status(data.status).send(data.message);
    });
});

app.get('/setting', (req, res) => {
  if (!req.query.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  readUser(req.query.userId)
    .then(user => res.send(user))
    .catch((e) => res.status(500).send(e));
});

app.post('/cancel', bodyParser.json(), (req, res) => {
  if (!req.body.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  deleteUser(req.body.userId)
    .then(() => ({ status: 200, message: '帳號取消綁定成功'}))
    .catch(() => ({ status: 500, message: '帳號取消綁定失敗'}))
    .then(data => {
      pushMessage(req.body.userId, data.message);
      res.sendStatus(data.status);
    });
});

app.post('/reset', bodyParser.json(), (req, res) => {
  if (!req.body.userId) {
    res.status(500).send('userId is empty.');
    return;
  }
  takeLeave(req.body.userId, true, true)
  .then(() => ({ status: 200, message: '重置請假狀態成功'}))
  .catch(() => ({ status: 500, message: '重置請假狀態失敗'}))
  .then(data => {
    pushMessage(req.body.userId, data.message);
    res.sendStatus(data.status);
  });
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
  readUser(req.body.userId).then((user) => {
    return signin.signin(user.account, user.password, req.query.time);
  }).then(message => { res.send(message); }).catch(e => {
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

  if (text === '登入測試') {
    return checkAccountPassword(userId)
      .then(readUser.bind(null, userId))
      .then(user => signin.login(user.account, user.password))
      .then(() => '登入成功')
      .catch(e => '登入失敗: ' + e)
      .then(message => replyMessage(event.replyToken, message));
  } else if (text === '打卡') {
    return checkAccountPassword(userId)
      .then(readUser.bind(null, userId))
      .then(user => signin.signin(user.account, user.password, getTime()))
      .catch(e => '打卡失敗: ' + e)
      .then(message => replyMessage(event.replyToken, message));
  } else if (text === '請整天') {
    return checkAccountPassword(userId)
      .then(takeLeave.bind(null, userId, false, false))
      .then(() => '已標記請整天，今天將不自動打卡')
      .catch(e => '標記請整天失敗: ' + e)
      .then(message => replyMessage(event.replyToken, message));
  } else if (text === '請早上') {
    return checkAccountPassword(userId)
      .then(takeLeave.bind(null, userId, false, true))
      .then(() => '已標記請早上，今天早上將不自動打卡')
      .catch(e => '標記請早上失敗: ' + e)
      .then(message => replyMessage(event.replyToken, message));
  } else if (text === '請下午') {
    return checkAccountPassword(userId)
      .then(takeLeave.bind(null, userId, true, false))
      .then(() => '已標記請下午，今天下午將不自動打卡')
      .catch(e => '標記請下午失敗: ' + e)
      .then(message => replyMessage(event.replyToken, message));
  } else {
    return readHelp()
      .catch(() => `help：\n測試帳號連線：登入測試\n立即打卡：打卡\n或使用選單功能。`)
      .then(message => replyMessage(event.replyToken, message));
  }
}

function checkAccountPassword(userId) {
  return readUser(userId).then(user => {
    if (!user || !user.account) {
      throw new Error('未設定帳號');
    } else if (!user || !user.password) {
      throw new Error('未設定密碼');
    }
  });
}

function takeLeave(userId, morning, afternoon) {
  return readUser(userId).then((user) => {
    user.workMorning = morning;
    user.workAfternoon = afternoon;
    return user;
  }).then(saveUser.bind(null, userId));
}

function getRandom(min, max) {
  return Math.floor(Math.random()*max)+min;
}

function getTime() {
  let date = new Date();
  date.setTime(date.getTime() - 60000);
  let hour = `${date.getHours()}`.padStart(2, '0');
  let minute = `${date.getMinutes()}`.padStart(2, '0');
  let time = `${hour}${minute}`;
  return time;
}

function autoSignIn(isMorning, isOffWork) {
  readUsers()
    .then(users => {
      users.forEach(user => {
        let offset = getRandom(0, 20) * 60 * 1000;
        console.log(`enqeeue auto Sign In for ${user.account} , wait ${offset / 60000} mins`);

        if (!(!isMorning && !isOffWork && !user.workMorning && user.workAfternoon ||
            !isMorning && isOffWork && !user.workMorning && user.workAfternoon ||
            !isMorning && isOffWork && user.workMorning && user.workAfternoon ||
            isMorning && !isOffWork && user.workMorning && !user.workAfternoon ||
            isMorning && !isOffWork && user.workMorning && user.workAfternoon ||
            isMorning && isOffWork && user.workMorning && !user.workAfternoon)) {
          console.log(`${user.account} take a leave, so cancel auto Sign In`);
          return;
        }

        setTimeout(function(user) {    
          console.log(`auto Sign In for ${user.account}`);
          signin.signin(user.account, user.password, getTime())
          .then(message => { 
            console.log(`auto Sign In for ${user.account}, ${message}`);
            return message;
          })
          .catch(e => '打卡失敗: ' + e)
          .then(message => pushMessage(user.userId, message));
        }.bind(null, user), offset);
      });
    });
}

function readHelp() {
  return firebase.database().ref('/help').once('value')
    .then(snapshot => snapshot.val())
    .then(help => {
      if (!help) throw new Error('Help not found');
      return help;
    });
}

function readUser(userId) {
  return firebase.database().ref(`/users/${userId}`).once('value')
    .then(snapshot => snapshot.val())
    .then(user => {
      if (!user) throw new Error('User not exist');
      return user;
    });
}

function readUsers() {
  return firebase.database().ref('/users').once('value')
    .then(snapshot => snapshot.val())
    .then(users => {
      return Object.keys(users)
        .filter(userId => { return users[userId] && users[userId].account && users[userId].password; })
        .map(userId => ({ userId, ...users[userId] }));
    })
}

function resetWorkState() {
  readUsers()
    .then(users => {
      return Promise.all(users.map(user => takeLeave(user.userId, true, true).catch(e => {
        console.log(`重置 ${user.userId} 請假狀態失敗: ${e}`);
      })));
    })
    .then(() => {
      console.log(`重置請假狀態完成`);
    });
}

function saveUser(userId, user) {
  return database.ref('users/' + userId).set(user);
}

function deleteUser(userId) {
  return saveUser(userId, null);
}

function pushMessage(userId, message) {
  if (!config.enablePushMessages) return;
  let reply = { type: 'text', text: message };
  client.pushMessage(userId, reply);
}

function replyMessage(replyToken, message) {
  let reply = { type: 'text', text: message };
  return client.replyMessage(replyToken, reply);
}

// listen on port
const port = process.env.PORT || 8080;
let server = app;

if (config.credentials.cert && config.credentials.key && config.credentials.ca) {
  let credentials = {
    cert: fs.readFileSync(config.credentials.cert, 'utf-8'),
    key: fs.readFileSync(config.credentials.key, 'utf-8'),
    ca: fs.readFileSync(config.credentials.ca, 'utf-8'),
  }
  server = https.createServer(credentials, app);
}

server.listen(port, () => {
  console.log(`listening on ${port}`);
});
