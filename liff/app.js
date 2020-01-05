let userInfo = {};
window.onload = function() {
    $('.bind-account').hide();
    $('.bind-info').hide();

    $('.bind-account button').on('click', () => {
      let account = $('#inputAccount').val().trim();
      let password = $('#inputPassword').val().trim();
      setting(userInfo.userId, account, password)
        .then(initView)
        .catch(() => {
          window.alert('綁定失敗');
          initView();
        });
    });
  
    liff.init({
      liffId: '1653725533-Wg9REdXE'
    }).then(initView)
    .catch((err) => {
      window.alert('Liff init failed');
    });
};

function initView() {
  $('.bind-account').hide();
  $('.bind-info').hide();
  // start to use LIFF's api
  if (!liff.isLoggedIn() && !liff.isInClient()) {
    liff.login();
  } else {
    liff.getProfile().then((profile) => {
      userInfo = profile;
  
      $('.bind-info h5').text(profile.displayName);
      $('.bind-info img')[0].src = profile.pictureUrl;
  
      getSetting(userInfo.userId).then((user) => {
        $('.bind-info').show();
        $('.bind-info .account span').text(user.account ? user.account : '未綁定');
        $('.bind-info .password span').text(user.password ? '已綁定' : '未綁定');
      }).catch(e => {
        $('.bind-account').show();
        $('.bind-info .account span').text('未綁定');
        $('.bind-info .password span').text('未綁定');
      });
    }).catch((error) => {
        window.alert('Error getting profile: ' + error);
    });
  }
}

function getSetting(userId) {
  return new Promise((resolve, reject) => {
    $.get('../setting', { userId: userId }, (user) => {
      resolve(JSON.parse(user));
    }).fail(() => {
      reject();
    });
  });
}

function setting(userId, account, password) {
  return new Promise((resolve, reject) => {
    $.post('../setting', {
      userId: userId,
      account: account,
      password: password
    }, () => {
      resolve();
    }).fail(() => {
      reject();
    });
  });
}