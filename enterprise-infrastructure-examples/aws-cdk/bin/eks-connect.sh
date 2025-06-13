#!/usr/bin/env bash

# This script automates the process of connecting to EKS clusters deployed via
# WickrEnterpriseCDK.
#
# Using the credentials for the current AWS CLI profile, it does the following:
#
#   1. Discovers the EKS cluster and bastion
#   2. Generates a temporary Kubernetes configuration file
#   3. Starts a port forward to the bastion server
#   4. Spawns a new shell with the `KUBECONFIG` environment variable set
#

set -eo pipefail

DEPENDENCIES=("aws" "session-manager-plugin" "pkill" "kubectl")

check_dependencies() {
    for dep in "${DEPENDENCIES[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            echo "Error: $dep is not installed or not in PATH." 1>&2
            exit 1
        fi
    done
}

assert_vars() {
    local -a VARS=("$@")

    for VAR in "${VARS[@]}"; do
        if [ -z "${!VAR}" ]; then
            echo "Error: The variable '$VAR' is empty or not set."
            exit 1
        fi
    done
}

get_cluster_name() {
    # Get a list of EKS clusters in the account
    CLUSTER_NAMES=$(aws eks list-clusters --query 'clusters[?starts_with(@, `WickrEnterprise`)]' --output text)

    if [ -z "$CLUSTER_NAMES" ]; then
        echo "No EKS clusters found in this account."
        exit 1
    fi

    # If there is only one cluster, automatically select it
    if [ $(echo "$CLUSTER_NAMES" | wc -w) -eq 1 ]; then
        CLUSTER_NAME="$CLUSTER_NAMES"
    else
        # Display the list of clusters with numbers
        echo "Available EKS clusters:"
        echo
        COUNTER=1
        for CLUSTER_NAME in $CLUSTER_NAMES; do
            echo "    $COUNTER. $CLUSTER_NAME"
            COUNTER=$((COUNTER+1))
        done
        echo

        # Prompt the user to select a cluster
        read -p "Select a cluster [1-$((COUNTER-1))]: " CLUSTER_CHOICE

        # Validate the user's choice
        if [ "$CLUSTER_CHOICE" -lt 1 ] || [ "$CLUSTER_CHOICE" -ge "$COUNTER" ]; then
            echo "Invalid choice. Exiting."
            exit 1
        fi

        # Get the selected cluster name
        CLUSTER_NAME=$(echo "$CLUSTER_NAMES" | awk -v choice="$CLUSTER_CHOICE" '{print $choice}')
    fi
}

generate_kubeconfig() {
    assert_vars CLUSTER_NAME

    KUBECONFIG=$(mktemp -t "$CLUSTER_NAME"+".XXXXXX")
    export KUBECONFIG
    echo "Generating temporary Kubeconfig at $KUBECONFIG"

    # Get the first Nodegroup and its CloudFormation stack name
    NODEGROUP_ARN=$(aws eks list-nodegroups --cluster-name "$CLUSTER_NAME" --query 'nodegroups[0]' --output text)
    STACK_NAME=$(aws eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$NODEGROUP_ARN" --query 'nodegroup.tags."aws:cloudformation:stack-name"' --output text)
    assert_vars STACK_NAME

    # Get IAM Principal for authentication from the Cloudformation stack outputs
    IAM_ROLE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?starts_with(OutputKey, `ExportsOutputFnGetAttWickrEksClusterAdmin`)].OutputValue' --output text)
    assert_vars IAM_ROLE_ARN
    aws eks update-kubeconfig --name "$CLUSTER_NAME" --role-arn "$IAM_ROLE_ARN" > /dev/null

    # Generate a random port between 32768-65535 for the bastion proxy connection
    BASTION_PROXY_PORT=$((RANDOM % 32768 + 32768))

    CLUSTER_ARN=$(aws eks describe-cluster --name "$CLUSTER_NAME" --query 'cluster.arn' --output text)
    kubectl config set "clusters.${CLUSTER_ARN}.proxy-url" "http://localhost:$BASTION_PROXY_PORT" > /dev/null
    kubectl config set-context --current --namespace=wickr > /dev/null
}

start_bastion_port_forward() {
    assert_vars STACK_NAME BASTION_PROXY_PORT

    # Find the bastion by looking for an instance with the same CloudFormation stack name tag
    INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag-key,Values=aws:cloudformation:stack-name" "Name=tag-value,Values=$STACK_NAME" "Name=instance-state-name,Values=running" --query 'Reservations[*].Instances[*].InstanceId' --output text | head -1)

    if [ -z "$INSTANCE_ID" ]; then
        echo "No Bastion found with the CloudFormation stack name tag: $STACK_NAME"
        exit 1
    fi

    echo "Starting port forward to bastion on local port $BASTION_PROXY_PORT"
    aws ssm start-session --target "$INSTANCE_ID" --document-name AWS-StartPortForwardingSession --parameters "portNumber=8888,localPortNumber=$BASTION_PROXY_PORT" > /dev/null  &
    SSM_PID=$!
}

main() {
    check_dependencies

    if [ -n "$1" ]; then
        CLUSTER_NAME="$1"
    else
        get_cluster_name
    fi

    echo "Selected EKS cluster: $CLUSTER_NAME"

    # Generate a temporary Kube configuration
    generate_kubeconfig

    start_bastion_port_forward

    # The AWS SSM command doesn't properly kill the `session-manager-plugin` process on SIGTERM
    # so use `pkill` to kill all processes with parent PID of the AWS SSM command.
    trap 'pkill -P $SSM_PID' EXIT

    # Start interactive shell
    echo
    echo "Spawning a new shell configured to connect to the EKS cluster"
    echo "Type \"exit\" or press Ctrl+D to close the EKS bastion proxy connection and return to your normal shell."
    bash
}

main "$@"
