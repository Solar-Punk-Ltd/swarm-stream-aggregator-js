# Example swarm stream GSOC Aggregator Server 🐝

This project provides an example implementation of a GSOC aggregator server designed to work with
[Solar-Punk-Ltd/mssd-ingestion](https://github.com/Solar-Punk-Ltd/mssd-ingestion).

The primary function of this server is to receive messages sent by the ingestion server via GSOC and consolidate them
into a more persistent, access-controlled Swarm feed (the "stream feed" or "app feed). This feed has information about
the stream's that should be displayed at client side.

**Note:** This is an example implementation. For production environments, consider enhancing aspects like, message
validation, schema enforcement, and feed writing policies.

---

## ⚙️ How It Works

The aggregator server operates through the following steps:

1.  **GSOC Subscription:** The server connects to a specified Bee node (`GSOC_BEE_URL`) and subscribes to updates on a
    particular GSOC resource (`GSOC_RESOURCE_ID`) and topic (`GSOC_TOPIC`).
2.  **Message Reception:** As new messages arrive on the GSOC feed, the server receives them.
3.  **Message Processing:** The server does a very basic validation and makes a simple aggregated list. The list of the
    streams that should be displayed on the client.
4.  **Stream Feed Writing:** Valid messages are then written to a separate, designated Swarm feed (the "stream feed" or
    "app feed"). This feed is managed by a different Bee node (`SWARM_BEE_URL`) and secured with a private key
    (`SWARM_KEY`), ensuring that only authorized entities (like this aggregator) can write to it. Writes to this feed
    require a valid postage stamp (`SWARM_STAMP`).

---

## 🔧 Configuration

The server requires the following environment variables to be set:

| Variable           | Description                                                                      |
| :----------------- | :------------------------------------------------------------------------------- |
| `GSOC_BEE_URL`     | The URL of the Bee node used for GSOC operations (subscribing to user messages). |
| `GSOC_RESOURCE_ID` | The mined Swarm resource ID of the GSOC feed the aggregator listens to.          |
| `GSOC_TOPIC`       | The specific topic hash on the GSOC feed that this aggregator monitors.          |
| `SWARM_BEE_URL`    | The URL of the Bee node used for writing to the consolidated stream feed.        |
| `SWARM_TOPIC`      | The human readable topic name of the stream feed.                                |
| `SWARM_KEY`        | The private key used to sign updates to the consolidated stream feed.            |
| `SWARM_STAMP`      | The postage stamp ID used for uploading content to the stream feed.              |

## 🚀 Running the Aggregator

### Option 1: Node.js (Direct)

1.  **Clone the repository:**
    ```bash
    git clone git@github.com:Solar-Punk-Ltd/swarm-stream-aggregator-js.git
    cd swarm-stream-aggregator-js
    ```
2.  **Install dependencies:**
    ```bash
    pnpm install
    ```
3.  **Set up your environment variables:** Create a `.env` file in the root of the project with the variables listed
    above, or set them in your deployment environment.
4.  **Build the server:**
    ```bash
    pnpm build
    ```
5.  **Start the server:**
    ```bash
    pnpm start
    ```

### Option 2: Docker

1.  **Clone the repository:**

    ```bash
    git clone git@github.com:Solar-Punk-Ltd/swarm-stream-aggregator-js.git
    cd swarm-stream-aggregator-js
    ```

2.  **Set up your environment variables:** Create a `.env` file in the root of the project with the required variables.

3.  **Build and run with Docker:**

    ```bash
    # Build the Docker image
    docker build -t swarm-stream-aggregator .

    # Run the container
    docker run -d \
      --name swarm-stream-aggregator \
      --env-file .env \
      --restart unless-stopped \
      swarm-stream-aggregator
    ```

---

## 💡 Limitations & Potential Improvements

This example serves as a basic illustration. For a more robust, production-ready aggregator, consider the following
enhancements:

- **Advanced Validation:** Introduce stricter validation rules and schemas for incoming messages to ensure data
  integrity and security.
- **Flexible Feed Logic:** Explore different strategies for organizing stream feeds (e.g., separeate feeds for different
  stream actions) depending on scale and requirements.
- **Error Handling & Resilience:** Improve error handling, implement retry mechanisms for Swarm operations, and ensure
  the aggregator can recover from transient network issues.
- **Monitoring & Logging:** Integrate comprehensive logging and monitoring to track the aggregator's health and
  performance.

---

## 📚 Resources

- [What are Feeds? (Official Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds#what-are-feeds)
- [GSOC Introduction (Official Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)
- [Solar-Punk-Ltd/mssd-ingestion](https://github.com/Solar-Punk-Ltd/mssd-ingestion)
- [Example Stream Client: Solar-Punk-Ltd/swarm-ingestion-stream-react-example](https://github.com/Solar-Punk-Ltd/swarm-ingestion-stream-react-example)
