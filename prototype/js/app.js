function updateClock() {
    const now = new Date();

    const dateElement = document.getElementById("date");
    const timeElement = document.getElementById("time");

    const dateOptions = {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    };

    const timeOptions = {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    };

    dateElement.textContent = now.toLocaleDateString(
        "en-GB",
        dateOptions
    );

    timeElement.textContent = now.toLocaleTimeString(
        "en-GB",
        timeOptions
    );
}

updateClock();

setInterval(updateClock, 1000);

/*--------------------------------
    Controls
--------------------------------*/


const devicesButton = document.querySelector(
    '[data-node="devices"]'
);

const homeScreen = document.getElementById(
    "home-screen"
);

const devicesScreen = document.getElementById(
    "devices-screen"
);

const backHomeButton = document.getElementById(
    "back-home"
);

devicesButton.addEventListener("click", () => {

    homeScreen.classList.add(
        "screen-leaving"
    );

    setTimeout(() => {

        devicesScreen.classList.remove(
            "hidden"
        );

    }, 150);

});


backHomeButton.addEventListener("click", () => {

    devicesScreen.classList.add(
        "hidden"
    );

    setTimeout(() => {

        homeScreen.classList.remove(
            "screen-leaving"
        );

    }, 150);

});