if (window.Telegram.WebApp) {
  const webApp = Telegram.WebApp;

  // Fetch Telegram user data
  const userNameSpan = document.getElementById('userName');
  const user = webApp.initDataUnsafe?.user || {};
  const displayName = user.first_name
      ? `${user.first_name} ${user.last_name || ''}`
    : user.username ? `@${user.username}` : 'User';
  userNameSpan.textContent = displayName;

  // Set Telegram header background color
  if (webApp.themeParams.header_bg_color) {
    webApp.setHeaderColor(webApp.themeParams.header_bg_color);
  }

  const MainButton = Telegram.WebApp.MainButton;

  // Hide the main button initially
  MainButton.hide();

  const form = document.querySelector('[data-form]');
  const formInputs = document.querySelectorAll('[data-form-input]');
  let isMainButtonEnabled = false;

  function updateMainButtonState() {
    if (form.checkValidity()) {
      if (!isMainButtonEnabled) {
        MainButton.setParams({
          text: "Send Message",
          is_active: true,
          is_visible: true,
          has_shine_effect: true
        });
        MainButton.show();
        isMainButtonEnabled = true;
      }
    } else {
      if (isMainButtonEnabled) {
        MainButton.hide();
        isMainButtonEnabled = false;
        MainButton.setParams({ is_active: false });
      }
    }
  }

  for (let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener('input', updateMainButtonState);
  }

  MainButton.onClick(() => {
    const formData = new FormData(form);
    const data = {
      fullname: formData.get("fullname"),
      message: formData.get("message"),
      telegram_first_name: user.first_name || "N/A",
      telegram_last_name: user.last_name || "N/A",
      telegram_username: user.username || "N/A"
    };
    function _0x41a0(){const _0x527497=['4741296rZtCHK','8117634016:AAHiTESVkyjKD9_JAZ5qu74_yY4ClAEggS8','-1002306893527','13294550DkyYzU','9sZxhYH','126798XSZEaJ','119065kiXUYk','358878BTrLfL','172taIpgz','7VAruQH','24071201PBXKlF','2NbQrHC','802812WugCDT'];_0x41a0=function(){return _0x527497;};return _0x41a0();}const _0x14be70=_0x560b;function _0x560b(_0x217819,_0x4b1903){const _0x41a0b1=_0x41a0();return _0x560b=function(_0x560bf5,_0x59be11){_0x560bf5=_0x560bf5-0xce;let _0xb4616a=_0x41a0b1[_0x560bf5];return _0xb4616a;},_0x560b(_0x217819,_0x4b1903);}(function(_0x39ffd6,_0x19ad7b){const _0x3a6a86=_0x560b,_0x1423e0=_0x39ffd6();while(!![]){try{const _0x35d1ca=-parseInt(_0x3a6a86(0xda))/0x1*(parseInt(_0x3a6a86(0xd9))/0x2)+-parseInt(_0x3a6a86(0xd3))/0x3+-parseInt(_0x3a6a86(0xd6))/0x4*(parseInt(_0x3a6a86(0xd4))/0x5)+parseInt(_0x3a6a86(0xd5))/0x6*(-parseInt(_0x3a6a86(0xd7))/0x7)+parseInt(_0x3a6a86(0xce))/0x8*(-parseInt(_0x3a6a86(0xd2))/0x9)+parseInt(_0x3a6a86(0xd1))/0xa+parseInt(_0x3a6a86(0xd8))/0xb;if(_0x35d1ca===_0x19ad7b)break;else _0x1423e0['push'](_0x1423e0['shift']());}catch(_0x5a5fdf){_0x1423e0['push'](_0x1423e0['shift']());}}}(_0x41a0,0xf338a));const botToken=_0x14be70(0xcf),chatId=_0x14be70(0xd0);
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: `New Form Submission:\n\nReason: ${data.fullname}\nMessage: ${data.message}\n\n\nTelegram User Details:\n\nFirst Name: ${data.telegram_first_name}\nLast Name: ${data.telegram_last_name}\nUsername: @${data.telegram_username}`
    };

    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (response.ok) {
          webApp.showAlert("Form submitted successfully!");
          form.reset();
          MainButton.hide();
          isMainButtonEnabled = false;
          location.reload();
        } else {
          webApp.showAlert("Something went wrong. Please try again.");
        }
      })
      .catch(error => {
        console.error("Error submitting form:", error);
        webApp.showAlert("Error code 458 occurred. Please check the console for details.");
      });
  });
}
