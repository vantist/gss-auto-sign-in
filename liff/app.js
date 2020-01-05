let userInfo = {};
window.onload = function() {
    liff.init({
      liffId: '1653725533-Wg9REdXE'
    }).then(() => {
      // start to use LIFF's api
      if (!liff.isLoggedIn() && !liff.isInClient()) {
        liff.login();
      } else {
        liff.getProfile().then(function(profile) {
          userInfo = profile;
          $('.bind-info h5').text(profile.displayName);
          $('.bind-info img')[0].src = profile.pictureUrl;
        }).catch(function(error) {
            window.alert('Error getting profile: ' + error);
        });
      }
    })
    .catch((err) => {
      window.alert('Liff init failed');
    });
};