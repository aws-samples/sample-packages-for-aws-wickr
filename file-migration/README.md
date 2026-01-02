# File Migration

This sample package helps users to migrate files from Legacy Wickr Enterprise to HA. The package should be used as a reference and modified to fit specific environments and use cases.
By default the `download.ts` script will download all contents of a remote S3 bucket to a local directory and the `upload.ts` script will upload all files in a local directory to a remote S3 bucket.

## Getting Started

### Requirements

- Node.js 20
- jq

### Install Dependencies

```bash
npm i
```

## Download Files from Legacy Server


### On dev machine
* NOTE: It is assumed that your docker host IP is 172.17.0.1, if yours is different, update these commands to reflect that. You can find your docker networks host IP by running `ip addrewss show device docker0` and grabbing the IPv4 address

1. Login to your Legacy Host machine as root and get the appropriate Secret values for S3_SECRET_KEY, S3_BUCKET, S3_ACCESS_KEY
  1. `docker exec -it fileproxy env|grep ^S3`
  1. Update the S3_SECRET_KEY, S3_ACCESS_KEY, S3_BUCKET values in the `.env` file in this repo
1. Port forward 4569 to the legacy server’s port 4569
    1. `ssh -N -L 127.0.0.1:4569:172.17.0.1:4569 user@legacy-server-ip`
    2. Or if the server is on AWS with SSM installed

        ```bash
        aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost \
            --parameters '{"portNumber":["4569"], "localPortNumber":["4569"], "host":["172.17.0.1"]}' \
            --target your-instance-id
        ```

1. Download files `npx tsx --env-file=.env download.ts`

## Upload Files to HA Server

### On the Embedded Cluster Machine

1. Login to the Embedded Cluster machine and run the `./wickr-enterprise-ha shell` command
1. Copy the file `/var/lib/embedded-cluster/k0s/pki/admin.conf` which should be the Kubeconfig file for the embedded cluster to your dev machine and put it somewhere easily accessible.


### On dev machine
1. Port forward port 6443 via ssh to the Embedded Cluster Machine
    1. `ssh -N -L 6443:127.0.0.1:6443 user@embedded-cluster-server-ip`
1. Export the Kubeconfig file you retrieved from the Embedded Cluster for use with subsequent `kubectl` commands
    1. `export KUBECONFIG=/path/to/file`
1. Get ACCESS_KEY_ID (root user) and SECRET_ACCESS_KEY (root password) from `wickr-s3-config`
    1. `kubectl -n kotsadm get secrets wickr-s3-config -o json | jq '.data | map_values(@base64d)'`
    1. Update HA_ACCESS_KEY_ID and HA_SECRET_ACCESS_KEY in the `.env` file, adjust any other values necessary under the `HA` header
1. Port forward from dev machine to minio headless service
    1. `kubectl -n kotsadm port-forward svc/wickr-s3-hl 9000:9000`
1. Upload files `npx tsx --env-file=.env upload.ts`
