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



// Form activated main button

if (window.Telegram.WebApp) {
  const MainButton = Telegram.WebApp.MainButton;

  // Hide the main button initially
  MainButton.hide();

  const form = document.querySelector('[data-form]');
  const formInputs = document.querySelectorAll('[data-form-input]');

  // Track the form validity state
  let isMainButtonEnabled = false;

  // Enable or disable the MainButton based on form validity
  function updateMainButtonState() {
    if (form.checkValidity()) {
      if (!isMainButtonEnabled) {
  MainButton.setText("Send Message"); // Set button text
  MainButton.show(); // Show the MainButton
  isMainButtonEnabled = true;

  // Enable Telegram's native shine effect
  MainButton.setParams({
    text: "Send Messege", // Button text
    is_active: true, // Activate the button
    is_visible: true, // Ensure the button is visible
    has_shine_effect: true // Enable shine effect
  }); // Activate native shine
}

    } else {
      if (isMainButtonEnabled) {
  MainButton.hide(); // Hide the MainButton
  isMainButtonEnabled = false;

  MainButton.setParams({ is_active: false }); // Deactivate native shine
}

    }
  }

  // Attach input event listeners to update button state
  for (let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener('input', updateMainButtonState);
  }

  // Add a single onClick listener for the MainButton
  MainButton.onClick(() => {
    const formData = new FormData(form);
    const data = {
      fullname: formData.get("fullname"),
      email: formData.get("email"),
      message: formData.get("message")
    };

    // Replace with your Telegram bot's API and group ID
    const botToken = "";
    const chatId = "-1002306893527";
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    // Prepare the request payload
    const payload = {
      chat_id: chatId,
      text: `New Form Submission:\n\nFull Name: ${data.fullname}\nEmail: ${data.email}\nMessage: ${data.message}`
    };

    // Send the data via a POST request
    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (response.ok) {
          Telegram.WebApp.showAlert("Form submitted successfully!");
          form.reset(); // Clear the form fields
          MainButton.hide(); // Hide the MainButton
          isMainButtonEnabled = false; // Reset the button state
          location.reload(); // Reload the page
        } else {
          Telegram.WebApp.showAlert("Something went wrong. Please try again.");
        }
      })
      .catch(error => {
        console.error("Error submitting form:", error);
        Telegram.WebApp.showAlert("An error occurred. Please check the console for details.");
      });
  });
}
