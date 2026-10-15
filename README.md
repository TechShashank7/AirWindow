# 🌬️ AirWindow — Clean Air Intelligence

> **Data-Driven Outdoor Window Recommendation & Hyperlocal Air Quality Intelligence Engine powered by AWS Serverless.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-AWS%20Amplify-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://main.d41eswby66so0.amplifyapp.com)
[![AWS Architecture](https://img.shields.io/badge/AWS-Serverless%20Architecture-232F3E?style=for-the-badge&logo=amazonwebservices&logoColor=FF9900)](https://main.d41eswby66so0.amplifyapp.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React%2019-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS_v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-123%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/TechShashank7/AirWindow)

---

## 🔗 Live Application

- 🌐 **Production Web App:** [https://main.d41eswby66so0.amplifyapp.com](https://main.d41eswby66so0.amplifyapp.com)
- ⚡ **API Gateway Base:** `https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com`
- 💻 **Target Audience:** Outdoor athletes, schools, campus administrators, parents, and health-conscious citizens navigating fluctuating air pollution.

---

## 📌 Executive Summary

Traditional weather and AQI dashboards are fundamentally **passive and reactive**: they show a single number describing how polluted the air is *right now*. For outdoor activity organizers, marathoners, schools, and families living in heavily polluted regions, that number does not answer the question that matters:

> *"If I need to go outside for 60 minutes today, **exactly when** is the cleanest, least hazardous window to do so?"*

**AirWindow** solves this by actively processing 48-hour forward-looking atmospheric forecasts alongside real-time ground observations. Rather than leaving users to eyeball confusing line graphs, AirWindow evaluates every possible continuous time interval and recommends the mathematically optimal outdoor window with the lowest pollutant concentration.

---

## 🌟 Key Features

| Feature | Description |
| :--- | :--- |
| 🎯 **Optimal Window Finder** | Select activity duration (30, 60, or 90 mins) and a preferred time range. The algorithm scores sliding windows across 48 hours to pinpoint the cleanest time slot. |
| 🇮🇳 **India National AQI (NAQI)** | Computes official Central Pollution Control Board (CPCB) sub-indices and dominant pollutant categories alongside global universal AQI metrics. |
| 📊 **Dual Trend Visualization** | Interactive 48-hour forecast chart showing PM2.5, PM10, and wind speed trends with custom tooltips, worst/cleanest visual tags, and time cursor scrubbing. |
| 🗺️ **Dual-Engine Map** | Seamless fallback between Google Maps Platform (with custom styled pins) and Leaflet / OpenStreetMap for 9-point spatial forecast grids and certified ground monitors. |
| ⚠️ **12-Hour Early Warning** | Automated spike detector warning users up to 12 hours before dangerous air quality surges occur. |
| 🔔 **Personalized Alerts** | Users subscribe to location-specific thresholds with zero friction. Powered by SHA-256 token authentication (no plaintext passwords stored). |

---

## 🏗️ AWS Cloud Architecture

AirWindow is built on an enterprise-grade, event-driven, **100% serverless AWS architecture** engineered for high throughput, sub-50ms latency, least-privilege security, and resilient failover.

```mermaid
flowchart TD
    subgraph CLIENT["1. Client & Edge Layer"]
        User["👤 User Browser<br/>(React 19 + TypeScript + Vite)"]
        Amplify["⚡ AWS Amplify Hosting<br/>(Global CDN Edge + CI/CD)"]
        User -->|1. Loads SPA| Amplify
    end

    subgraph API["2. API & Compute Layer"]
        APIGW["🚪 Amazon API Gateway<br/>(HTTP API with CORS)"]
        LambdaEval["⚙️ AWS Lambda: AirWindowEvaluate<br/>(Forecast Engine & NAQI Logic)"]
        LambdaAlerts["🔑 AWS Lambda: AirWindowAlertsApi<br/>(SHA-256 Auth & Subscriptions)"]
        
        User -->|2. /evaluate, /current-aqi, /observations| APIGW
        User -->|3. /alerts (Subscribe, Manage, Verify)| APIGW
        APIGW -->|Proxy| LambdaEval
        APIGW -->|Proxy| LambdaAlerts
    end

    subgraph DATA["3. Data & Caching Layer"]
        DDBForecast["🗄️ Amazon DynamoDB<br/>AirWindow-ForecastCache (TTL)"]
        DDBAlerts["🗄️ Amazon DynamoDB<br/>AirWindow-Alerts (StatusIndex GSI)"]
        ExtAPIs["🌐 External Weather & Air Quality APIs<br/>(Open-Meteo • OpenAQ v3)"]

        LambdaEval <-->|4. Read/Write Cache (6h TTL)| DDBForecast
        LambdaEval -->|5. Cache Miss Fallback| ExtAPIs
        LambdaAlerts <-->|6. Atomic Transactions| DDBAlerts
    end

    subgraph ALERTS["4. Automated Event-Driven Pipeline"]
        EventBridge["⏱️ Amazon EventBridge<br/>(Hourly Cron Trigger)"]
        LambdaCron["🔍 AWS Lambda: AirWindowAlertsEvaluator<br/>(12h Spike Detector)"]
        SQS["📬 Amazon SQS<br/>AirWindow-AlertsQueue (Dead Letter)"]
        LambdaWorker["👷 AWS Lambda: AirWindowSesWorker<br/>(Batch Consumer)"]
        SES["✉️ Amazon Simple Email Service (SES)<br/>(Instant Email Delivery)"]

        EventBridge -->|7. Hourly Trigger| LambdaCron
        LambdaCron -->|8. Query Active Subscriptions| DDBAlerts
        LambdaCron -->|9. Check Forecast Spikes| DDBForecast
        LambdaCron -->|10. Enqueue Verified Breaches| SQS
        SQS -->|11. Batch Trigger| LambdaWorker
        LambdaWorker -->|12. Send Alert Notification| SES
        SES -->|13. Warning Email with Manage Link| User
    end

    subgraph OBS["5. Observability & Security"]
        CloudWatch["📊 Amazon CloudWatch<br/>(Structured Logs & Custom EMF Metrics)"]
        IAM["🛡️ AWS IAM<br/>(Least-Privilege Role Policies)"]
        
        LambdaEval -.->|Metrics| CloudWatch
        LambdaAlerts -.->|Metrics| CloudWatch
        LambdaCron -.->|EMF Logs| CloudWatch
        LambdaWorker -.->|EMF Logs| CloudWatch
    end

    classDef aws fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#232F3E;
    classDef client fill:#EBF8FF,stroke:#3182CE,stroke-width:2px,color:#2B6CB0;
    classDef comp fill:#ED8936,stroke:#7B341E,stroke-width:2px,color:#FFFFFF;
    classDef store fill:#4FD1C5,stroke:#234E52,stroke-width:2px,color:#1D4044;
    classDef alert fill:#FC8181,stroke:#742A2A,stroke-width:2px,color:#FFFFFF;

    class Amplify,APIGW comp;
    class LambdaEval,LambdaAlerts,LambdaCron,LambdaWorker comp;
    class DDBForecast,DDBAlerts store;
    class EventBridge,SQS,SES alert;
```

---

## 🛠️ Deep-Dive: AWS Services Used & Roles

| AWS Service | Component Name | Role & Responsibility in AirWindow |
| :--- | :--- | :--- |
| **AWS Amplify** | Hosting & CDN | Serves the production React 19 single-page application over AWS's global edge network with automatic GitHub branch-based continuous deployment. |
| **Amazon API Gateway** | HTTP API | Low-latency, cost-effective entry point routing REST traffic (`/evaluate`, `/current-aqi`, `/observations`, `/alerts`) with configured CORS preflight headers and sub-second proxy dispatch. |
| **AWS Lambda** | `AirWindowEvaluate` | Serverless compute engine calculating sliding-window averages, relative pollution scores, CPCB NAQI sub-indices, and multi-source spatial aggregations. |
| **AWS Lambda** | `AirWindowAlertsApi` | Manages user subscriptions using `TransactWriteItemsCommand` for concurrency safety and cryptographic SHA-256 token hashing for safe management authentication. |
| **AWS Lambda** | `AirWindowAlertsEvaluator` | Hourly cron-triggered worker that queries active subscriptions, evaluates forward-looking 12-hour forecasts, and enqueues spike breaches. |
| **AWS Lambda** | `AirWindowSesWorker` | Decoupled SQS batch consumer that idempotently delivers warning emails with built-in partial failure reporting (`batchItemFailures`). |
| **Amazon DynamoDB** | `AirWindow-ForecastCache` | Ultra-fast geospatial grid cache indexed by latitude, longitude, and rounded hourly timestamps with automatic Time-To-Live (TTL) expiration to avoid upstream API rate limits. |
| **Amazon DynamoDB** | `AirWindow-Alerts` | Highly durable subscriber database featuring a `StatusIndex` Global Secondary Index (GSI) allowing $O(1)$ lookups of active alerts. |
| **Amazon EventBridge** | Cron Rule | Fires an hourly schedule trigger (`rate(1 hour)`) kicking off the automated spike evaluation engine without requiring persistent EC2 instances. |
| **Amazon SQS** | `AirWindow-AlertsQueue` | Fault-tolerant queue decoupling the spike detection evaluation from email delivery, absorbing traffic bursts with dead-letter queue (DLQ) retry isolation. |
| **Amazon SES** | Email Engine | High-deliverability transactional email service sending subscription confirmations and critical hazardous spike warnings. |
| **Amazon CloudWatch** | Metrics & Logs | Ingests structured JSON logs and real-time custom Embedded Metric Format (EMF) counters (`AlertsEvaluated`, `CacheHits`, `EmailsDelivered`, `EmailFailures`). |
| **AWS IAM** | Execution Roles | Enforces strict least-privilege security policies, ensuring each Lambda function can only access its specific table, queue, or SES identity. |

---

## 🔬 Mathematical Formulation & Recommendation Logic

### 1. Relative Pollution Score
The comparative metric used to score any given hour $t$ balances both fine particulate matter ($\text{PM}_{2.5}$) and coarse inhalable particles ($\text{PM}_{10}$):

$$\text{Score}(t) = \text{PM}_{2.5}(t) + \left(0.5 \times \text{PM}_{10}(t)\right)$$

### 2. Sliding Window Optimization
For a user-selected outdoor activity duration $D \in \{30, 60, 90\}$ minutes within their preferred start time $T_{\text{start}}$ and end time $T_{\text{end}}$, the algorithm identifies window $[w, w + D]$ minimizing the integrated exposure:

$$w^* = \arg\min_{w \in [T_{\text{start}}, \, T_{\text{end}} - D]} \frac{1}{D} \int_{w}^{w + D} \text{Score}(t) \, dt$$

The best window is benchmarked against the worst available window in the same timeframe to compute the **Relative Safety Improvement Percentage**:

$$\Delta_{\text{improvement}} = \frac{\text{Score}_{\text{worst}} - \text{Score}_{\text{recommended}}}{\text{Score}_{\text{worst}}} \times 100\%$$

### 3. India National Air Quality Index (NAQI)
AirWindow implements the Central Pollution Control Board (CPCB) piecewise linear interpolation formula across 6 sub-index categories:

$$I_p = I_{\text{low}} + \frac{I_{\text{high}} - I_{\text{low}}}{B_{\text{high}} - B_{\text{low}}} \times \left(C_p - B_{\text{low}}\right)$$

The overall National AQI is determined by the highest sub-index: $\text{NAQI} = \max_p (I_p)$.

---

## 🔌 API Endpoints Summary

All routes are hosted on API Gateway (`https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com`):

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/evaluate` | Calculates the cleanest outdoor window and returns full 48h hourly forecasts. |
| `GET` | `/current-aqi?lat={lat}&lon={lon}` | Returns real-time conditions, CPCB NAQI, and individual pollutant breakdown. |
| `GET` | `/observations?lat={lat}&lon={lon}` | Returns verified physical ground monitoring stations from OpenAQ v3. |
| `POST` | `/alerts` | Registers a new air alert subscription with email verification token. |
| `POST` | `/alerts/verify` | Activates an alert subscription using a one-time cryptographic token. |
| `POST` | `/alerts/manage` | Unified route for subscribers to `LIST`, `PAUSE`, `RESUME`, or `DELETE` active alerts. |

---

## 💻 Local Development Setup

### Prerequisites
- **Node.js** >= 20.x
- **npm** >= 10.x
- *(Optional)* AWS CLI configured with credentials for deploying backend changes.

### 1. Clone the Repository
```bash
git clone https://github.com/TechShashank7/AirWindow.git
cd AirWindow
```

### 2. Install Dependencies
```bash
# Install frontend dependencies
npm install

# Install Lambda backend dependencies
cd lambda && npm install && cd ..
```

### 3. Environment Variables
Create a `.env` file in the project root:
```env
VITE_EVALUATE_API_URL=https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Verification

AirWindow maintains a comprehensive test suite across frontend and serverless backend layers:

```bash
# 1. Run Frontend Vitest Suite (59 tests covering React components & algorithms)
npm test

# 2. Run Backend Lambda Jest Suite (64 tests covering transactions, idempotency & auth)
cd lambda && npx jest --runInBand && cd ..

# 3. Type Checking & Production Build
npm run build

# 4. Code Quality & Linting
npm run lint
```

---

## 📦 Lambda Deployment Packaging

To package the backend functions for deployment to AWS Lambda:
```powershell
# Run the PowerShell packaging script on Windows
.\build-lambda-zip.ps1
```
This generates `lambda-deployment.zip` containing all Lambda handlers, dependency manifests, and utility modules ready for AWS upload.

---

## 📄 License & Acknowledgments

- **License:** Distributed under the MIT License.
- **Atmospheric Modeling:** [Open-Meteo Air Quality API](https://open-meteo.com/)
- **Ground Sensor Observations:** [OpenAQ v3](https://openaq.org/)
- **Geocoding & Maps:** Google Maps Platform & OpenStreetMap / Leaflet
