# File Migration

This sample package helps users to migrate files from Legacy Wickr Enterprise to HA. The package should be used as a reference and modified to fit specific environments and use cases.

## Getting Started

### Requirements

- Node.js 20
- jq

### Install Dependencies

```bash
npm i
```

## Download Files from Legacy Server

Get ACCESS_KEY_ID and SECRET_ACCESS_KEY from Legacy server `sudo docker exec filemanager env`.

Update ACCESS_KEY_ID and SECRET_ACCESS_KEY in the `.env` file

### On dev machine

1. Port forward 4569 to the legacy server’s port 4569
    1. `ssh -N -L 127.0.0.1:4569:172.17.0.1:4569 user@legacy-server-ip`
    2. Or if the server is on AWS

        ```bash
        aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost \
            --parameters '{"portNumber":["4569"], "localPortNumber":["4569"], "host":["172.17.0.1"]}' \
            --target your-instance-id
        ```

2. Download files `npx tsx --env-file=.env download.ts`

## Upload Files to HA Server

### On dev machine

1. Get ACCESS_KEY_ID (root user) and SECRET_ACCESS_KEY (root password) from `wickr-s3-config`
    1. `kubectl -n kotsadm get secrets wickr-s3-config -o json | jq '.data | map_values(@base64d)'`
    2. Update HA_ACCESS_KEY_ID and HA_SECRET_ACCESS_KEY in the `.env` file
2. Port forward from dev machine to minio headless service
    1. `kubectl -n kotsadm port-forward svc/wickr-s3-hl 9000:9000`
3. Upload files `npx tsx --env-file=.env upload.ts`
