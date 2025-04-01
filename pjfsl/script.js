'use strict';
(function () {
  // Ensure the Telegram WebApp API is available
  if (!window.Telegram || !Telegram.WebApp) {
    console.error("Telegram WebApp API is not available.");
    return;
  }

  // Utility function to shade a hex color by a percentage.
  // A negative percentage darkens the color, while a positive value lightens it.
  function shadeColor(color, percent) {
    let num = parseInt(color.slice(1), 16),
      amt = Math.round(2.55 * percent),
      R = (num >> 16) + amt,
      G = ((num >> 8) & 0x00ff) + amt,
      B = (num & 0x0000ff) + amt;
    return (
      "#" +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
    );
  }

  // Function to update the CSS variables based on Telegram's current theme
  function updateTelegramTheme() {
    const theme = Telegram.WebApp.theme || {};
    const root = document.documentElement;

    // Use Telegram's provided colors, or fall back to defaults
    // Telegram typically provides values like bg_color, text_color, and button_color.
    const primary = theme.bg_color || "#ffffff";
    const textColor = theme.text_color || "#000000";
    const buttonColor = theme.button_color || "#0088cc";

    // Compute gradients and color variants based on Telegram's theme.
    // Adjust the percentage values to modify lightness/darkness.
    const bg_gradient_onyx = `linear-gradient(to bottom right, ${shadeColor(primary, -10)} 3%, ${shadeColor(primary, -20)} 97%)`;
    const bg_gradient_jet = `linear-gradient(to bottom right, ${shadeColor(primary, -15)} 3%, ${shadeColor(primary, -25)} 100%), ${shadeColor(primary, -30)}`;
    const bg_gradient_yellow1 = `linear-gradient(to bottom right, ${shadeColor(buttonColor, 10)} 0%, ${shadeColor(buttonColor, 0)} 50%)`;
    const bg_gradient_yellow2 = `linear-gradient(135deg, ${shadeColor(buttonColor, 10)} 0%, ${shadeColor(buttonColor, 0)} 60%), ${shadeColor(primary, -30)}`;
    const border_gradient_onyx = `linear-gradient(to bottom right, ${shadeColor(primary, -30)} 0%, ${shadeColor(primary, -30)} 50%)`;
    const text_gradient_yellow = `linear-gradient(to right, ${buttonColor}, ${shadeColor(buttonColor, 5)})`;

    // Compute additional color variants
    const jet = shadeColor(primary, -15);
    const onyx = shadeColor(primary, -30);
    const eerie_black1 = shadeColor(primary, -35);
    const eerie_black2 = shadeColor(primary, -40);
    const smoky_black = shadeColor(primary, -50);
    const white1 = "#ffffff";
    const white2 = "#f6f6f6";
    const orange_yellow_crayola = buttonColor;
    const vegas_gold = shadeColor(buttonColor, -10);
    const light_gray = "#d3d3d3";
    const light_gray70 = "rgba(211,211,211,0.7)";
    const bittersweet_shimmer = shadeColor(buttonColor, 5);

    // Update all the CSS custom properties (variables)
    root.style.setProperty("--bg-gradient-onyx", bg_gradient_onyx);
    root.style.setProperty("--bg-gradient-jet", bg_gradient_jet);
    root.style.setProperty("--bg-gradient-yellow1", bg_gradient_yellow1);
    root.style.setProperty("--bg-gradient-yellow2", bg_gradient_yellow2);
    root.style.setProperty("--border-gradient-onyx", border_gradient_onyx);
    root.style.setProperty("--text-gradient-yellow", text_gradient_yellow);

    root.style.setProperty("--jet", jet);
    root.style.setProperty("--onyx", onyx);
    root.style.setProperty("--eerie-black1", eerie_black1);
    root.style.setProperty("--eerie-black2", eerie_black2);
    root.style.setProperty("--smoky-black", smoky_black);
    root.style.setProperty("--white1", white1);
    root.style.setProperty("--white2", white2);
    root.style.setProperty("--orange-yellow-crayola", orange_yellow_crayola);
    root.style.setProperty("--vegas-gold", vegas_gold);
    root.style.setProperty("--light-gray", light_gray);
    root.style.setProperty("--light-gray70", light_gray70);
    root.style.setProperty("--bittersweet-shimmer", bittersweet_shimmer);
  }

  // Apply the Telegram theme on page load
  updateTelegramTheme();

  // Listen for Telegram theme changes and update CSS accordingly
  Telegram.WebApp.onEvent("themeChanged", updateTelegramTheme);
})();

//Opening or closing side bar

const elementToggleFunc = function (elem) { elem.classList.toggle("active"); }

const sidebar = document.querySelector("[data-sidebar]");
const sidebarBtn = document.querySelector("[data-sidebar-btn]");

sidebarBtn.addEventListener("click", function() {elementToggleFunc(sidebar); })

//Activating Modal-testimonial

const testimonialsItem = document.querySelectorAll('[data-testimonials-item]');
const modalContainer = document.querySelector('[data-modal-container]');
const modalCloseBtn = document.querySelector('[data-modal-close-btn]');
const overlay = document.querySelector('[data-overlay]');

const modalImg = document.querySelector('[data-modal-img]');
const modalTitle = document.querySelector('[data-modal-title]');
const modalText = document.querySelector('[data-modal-text]');

const testimonialsModalFunc = function () {
    modalContainer.classList.toggle('active');
    overlay.classList.toggle('active');
}

for (let i = 0; i < testimonialsItem.length; i++) {
    testimonialsItem[i].addEventListener('click', function () {
        modalImg.src = this.querySelector('[data-testimonials-avatar]').src;
        modalImg.alt = this.querySelector('[data-testimonials-avatar]').alt;
        modalTitle.innerHTML = this.querySelector('[data-testimonials-title]').innerHTML;
        modalText.innerHTML = this.querySelector('[data-testimonials-text]').innerHTML;

        testimonialsModalFunc();
    })
}

//Activating close button in modal-testimonial

modalCloseBtn.addEventListener('click', testimonialsModalFunc);
overlay.addEventListener('click', testimonialsModalFunc);

//Activating Filter Select and filtering options

const select = document.querySelector('[data-select]');
const selectItems = document.querySelectorAll('[data-select-item]');
const selectValue = document.querySelector('[data-select-value]');
const filterBtn = document.querySelectorAll('[data-filter-btn]');

select.addEventListener('click', function () {elementToggleFunc(this); });

for(let i = 0; i < selectItems.length; i++) {
    selectItems[i].addEventListener('click', function() {

        let selectedValue = this.innerText.toLowerCase();
        selectValue.innerText = this.innerText;
        elementToggleFunc(select);
        filterFunc(selectedValue);

    });
}

const filterItems = document.querySelectorAll('[data-filter-item]');

const filterFunc = function (selectedValue) {
    for(let i = 0; i < filterItems.length; i++) {
        if(selectedValue == "all") {
            filterItems[i].classList.add('active');
        } else if (selectedValue == filterItems[i].dataset.category) {
            filterItems[i].classList.add('active');
        } else {
            filterItems[i].classList.remove('active');
        }
    }
}

//Enabling filter button for larger screens 

let lastClickedBtn = filterBtn[0];

for (let i = 0; i < filterBtn.length; i++) {
    
    filterBtn[i].addEventListener('click', function() {

        let selectedValue = this.innerText.toLowerCase();
        selectValue.innerText = this.innerText;
        filterFunc(selectedValue);

        lastClickedBtn.classList.remove('active');
        this.classList.add('active');
        lastClickedBtn = this;

    })
}

// Enabling Contact Form

const form = document.querySelector('[data-form]');
const formInputs = document.querySelectorAll('[data-form-input]');
const formBtn = document.querySelector('[data-form-btn]');

for(let i = 0; i < formInputs.length; i++) {
    formInputs[i].addEventListener('input', function () {
        if(form.checkValidity()) {
            formBtn.removeAttribute('disabled');
        } else { 
            formBtn.setAttribute('disabled', '');
        }
    })
}

// Enabling Page Navigation 

const navigationLinks = document.querySelectorAll('[data-nav-link]');
const pages = document.querySelectorAll('[data-page]');

for(let i = 0; i < navigationLinks.length; i++) {
    navigationLinks[i].addEventListener('click', function() {
        
        for(let i = 0; i < pages.length; i++) {
            if(this.innerHTML.toLowerCase() == pages[i].dataset.page) {
                pages[i].classList.add('active');
                navigationLinks[i].classList.add('active');
                window.scrollTo(0, 0);
            } else {
                pages[i].classList.remove('active');
                navigationLinks[i]. classList.remove('active');
            }
        }
    });
}
