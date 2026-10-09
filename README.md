# AirWindow

AirWindow is a minimalist web application that helps campus administrators and outdoor activity organizers find the best time windows for outdoor activities by analyzing 48-hour hourly air-pollution forecasts.

## Features

- **Location Search:** Easily search for any city globally.
- **Hourly Forecast:** View the PM2.5 and PM10 concentrations over the next 48 hours.
- **Recommendation Engine:** Select your preferred outdoor activity duration (30, 60, or 90 mins) and time window. The app will identify the optimal time slot with the lowest relative pollution score.
- **Transparent Scoring:** The relative pollution score is calculated simply as `PM2.5 + (0.5 * PM10)` to provide a comparative metric.

## Important Disclaimer & Data Integrity

- **Modelled Forecasts:** Data is fetched from the [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) and represents **modelled forecasts**, not real-time measurements from ground monitoring stations. Forecasts can deviate from reality.
- **Not an Official AQI:** The calculated relative pollution score is a transparent custom metric designed solely for comparing time slots. **It is NOT India's official CPCB AQI** or any other government standard.
- **No Guarantees:** Recommendations are based purely on comparative modelled data. An activity recommendation is not a guarantee of safety. When pollution levels are high, always exercise caution and consider local advisories.

## Setup Instructions

This project is built with React, Vite, and TypeScript. It uses Tailwind CSS for styling and Recharts for data visualization.

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run Development Server:**
    ```bash
    npm run dev
    ```
    Open `http://localhost:5173` in your browser.

3.  **Run Tests:**
    ```bash
    npm run test
    ```
    Tests cover the core recommendation algorithm (`src/utils/recommendation.test.ts`).

4.  **Production Build:**
    ```bash
    npm run build
    ```
    This command compiles the TypeScript and generates optimized static files in the `dist` folder. The app is ready to be hosted on static hosting services like AWS Amplify Hosting without any extra server-side configuration.

## Technologies Used

- React + Vite
- TypeScript
- Tailwind CSS
- Recharts
- date-fns
- Lucide React (Icons)
- Vitest & Testing Library
