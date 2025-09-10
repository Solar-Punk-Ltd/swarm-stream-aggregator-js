# Swarm Stream GSOC Aggregator Server 🐝

A token-authenticated GSOC aggregator server that processes stream management messages and maintains a consolidated
state feed on Swarm. This server works in conjunction with
[Solar-Punk-Ltd/msrs-ingestion](https://github.com/Solar-Punk-Ltd/msrs-ingestion) to provide a complete streaming
infrastructure.

## 📋 Overview

The aggregator server acts as a central processor for stream management operations, receiving token-authenticated
messages via GSOC and maintaining an authoritative stream state on a Swarm feed. It validates tokens, processes CRUD
operations, and manages stream metadata in a decentralized manner.

## ⚙️ Architecture

### Core Components

1. **AuthService**: Token validation and decryption using AES-256-GCM
2. **MessageProcessor**: Routes messages to appropriate handlers based on action type
3. **StateManager**: Manages stream state with CRUD operations and validation
4. **SwarmAggregator**: Main orchestrator handling GSOC subscription and feed writing

### Message Flow

1. **Token Reception**: Encrypted tokens are received via GSOC subscription
2. **Authentication**: Tokens are validated and decrypted to extract user credentials and message payload
3. **Message Processing**: Messages are routed to action-specific handlers (Create/Update/Delete)
4. **State Management**: Stream state is updated according to the action
5. **Feed Writing**: Updated state is written to a Swarm feed for persistence

## 🔐 Authentication System

The server implements token-based authentication with the following features:

- **Encrypted Payloads**: Messages are encrypted using AES-256-GCM
- **HMAC Signatures**: Token integrity verified using HMAC-SHA256
- **Expiration Checks**: Tokens have built-in expiration timestamps
- **Optional Auth**: Authentication can be disabled for development via `REQUIRE_AUTH`

### Token Structure

Tokens contain:

- User credentials (userId, userSecret)
- Instance identifier
- Encrypted message payload
- Creation and expiration timestamps
- HMAC signature for verification

## 🎯 Supported Actions

### CREATE

Creates a new stream entry with metadata:

- Title, description, thumbnail
- Media type (video/audio)
- Scheduled start time
- Stream state

### UPDATE

Modifies existing stream metadata while preserving creation timestamp

### DELETE

Removes a stream from the state

## 🔧 Configuration

### Environment Variables

| Variable           | Description                                    | Required |
| :----------------- | :--------------------------------------------- | :------- |
| `GSOC_BEE_URL`     | Bee node URL for GSOC subscription             | Yes      |
| `GSOC_RESOURCE_ID` | Mined GSOC resource ID to monitor              | Yes      |
| `GSOC_TOPIC`       | GSOC topic hash for subscription               | Yes      |
| `STREAM_BEE_URL`   | Bee node URL for feed writing                  | Yes      |
| `STREAM_TOPIC`     | Human-readable topic for stream feed           | Yes      |
| `STREAM_KEY`       | Private key for signing feed updates           | Yes      |
| `STREAM_STAMP`     | Postage stamp for Swarm uploads                | Yes      |
| `API_KEY`          | Secret key for token decryption                | Yes      |
| `REQUIRE_AUTH`     | Enable/disable authentication (`true`/`false`) | Yes      |

### Example `.env` file

```env
# GSOC Configuration
GSOC_BEE_URL=http://localhost:1633
GSOC_RESOURCE_ID=0000000000000000000000000000000000000000000000000000000000000000
GSOC_TOPIC=STREAM_UPDATES

# Swarm Feed Configuration
STREAM_BEE_URL=http://localhost:1633
STREAM_TOPIC=stream-state
STREAM_KEY=your-private-key-hex
STREAM_STAMP=your-postage-stamp

# Authentication
REQUIRE_AUTH=true
API_KEY=your-secret-api-key
```

## 🚀 Running the Aggregator

### Option 1: Node.js

```bash
# Clone repository
git clone git@github.com:Solar-Punk-Ltd/swarm-stream-aggregator-js.git
cd swarm-stream-aggregator-js

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Build and start
pnpm build
pnpm start
```

### Option 2: Docker

```bash
# Build Docker image
docker build -t swarm-stream-aggregator .

# Run container
docker run -d \
  --name swarm-stream-aggregator \
  --env-file .env \
  --restart unless-stopped \
  swarm-stream-aggregator
```

## 📊 State Management

### State Entry Structure

```typescript
interface StateEntry {
  owner: string; // Stream owner address
  topic: string; // Stream topic identifier
  title: string; // Stream title
  description: string; // Stream description
  state: StateType; // SCHEDULED/LIVE/ENDED
  mediaType: MediaType; // VIDEO/AUDIO
  thumbnail?: string; // Swarm reference to thumbnail
  scheduledStartTime?: string;
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}
```

### State Constraints

- **Maximum Entries**: Limited to 5 concurrent streams (configurable)
- **Deduplication**: Prevents duplicate owner/topic combinations
- **Automatic Timestamps**: Creation and update times managed automatically
- **FIFO Eviction**: Oldest entry removed when limit exceeded

## 🔄 Message Processing Pipeline

1. **Token Parsing**: Extract token from GSOC message bytes
2. **Authentication**: Validate token signature and decrypt payload
3. **Action Routing**: Route to appropriate handler based on action type
4. **State Validation**: Validate entry data before state modification
5. **State Update**: Apply changes to current state
6. **Feed Persistence**: Write updated state to Swarm feed

## 🛡️ Security Features

- **Token Expiration**: Automatic rejection of expired tokens
- **Message Deduplication**: Cache prevents processing duplicate messages
- **Signature Verification**: HMAC validation ensures message integrity
- **Encrypted Transport**: All message payloads are encrypted
- **Private Feed Writing**: Only authorized aggregator can update feed

## 📝 Logging

Comprehensive logging includes:

- Authentication success/failure
- Message processing results
- State changes
- Feed write confirmations
- Error conditions with stack traces

## 🔗 Integration

### With msrs-ingestion

The aggregator processes stream state changes triggered by the ingestion server

### With msrs-client

The aggregator processes stream state changes triggered by a generated msrs-utils user

### With Client Applications

Clients read the consolidated feed to display available streams

### Token Generation

Tokens can be generated using:

- [msrs-utils](https://github.com/Solar-Punk-Ltd/msrs-utils)
- Client-side token generators
- Custom implementations following the token specification

## 💡 Development Tips

### Running Without Authentication

For development, set `REQUIRE_AUTH=false` to bypass token validation

### Testing Token Generation

Use the msrs-utils auth-manager to generate test tokens

### Monitoring State

Check the Swarm feed directly:

```bash
curl http://localhost:1633/feeds/<owner>/<topic>
```

## ⚠️ Production Considerations

1. **Key Security**: Store private keys and API keys securely
2. **Stamp Management**: Monitor postage stamp balance and TTL
3. **Error Recovery**: Implement monitoring for failed message processing
4. **State Backup**: Consider periodic state snapshots
5. **Rate Limiting**: Add rate limiting for message processing if needed
6. **Scaling**: Use message queue for high-volume scenarios

## 📚 Resources

- [Swarm Feeds Documentation](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds)
- [GSOC Documentation](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc)
- [msrs-ingestion](https://github.com/Solar-Punk-Ltd/msrs-ingestion)
- [msrs-utils](https://github.com/Solar-Punk-Ltd/msrs-utils)
- [Example Client](https://github.com/Solar-Punk-Ltd/swarm-ingestion-stream-react-example)
