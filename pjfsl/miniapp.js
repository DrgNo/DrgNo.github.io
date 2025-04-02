// Username Fetching
const userNameSpan = document.getElementById('userName');

        if (Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user) {
            const user = Telegram.WebApp.initDataUnsafe.user;
            const firstName = user.first_name || '';
            const lastName = user.last_name || '';
            const username = user.username || '';

            let displayName = '';

            if (firstName && lastName) {
                displayName = `${firstName} ${lastName}`;
            } else if (firstName) {
                displayName = firstName;
            } else if (username) {
                displayName = `@${username}`;
            } else {
                displayName = 'User'; // Default if no info is available
            }

            userNameSpan.textContent = displayName;
        } else {
            userNameSpan.textContent = 'User'; // Handle cases outside Telegram Mini App
        }


//Set header Background
const webApp = window.Telegram.WebApp;

// Set header background color
if (webApp.themeParams.header_bg_color) {
  webApp.setHeaderColor(webApp.themeParams.header_bg_color);
}