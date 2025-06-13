#!/usr/bin/env -S npx ts-node
import { CloudFormation } from '@aws-sdk/client-cloudformation'
import { SecretsManager } from '@aws-sdk/client-secrets-manager'
import { readFileSync } from 'fs'
import { join } from 'path'

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
const cloudformation = new CloudFormation({ region })
const secretsmanager = new SecretsManager({ region })

type KotsConfigValue = {
  default?: string
  filename?: string
  value?: string
  valuePlaintext?: string
}

type KotsConfig = {
  apiVersion: 'kots.io/v1beta1'
  kind: 'ConfigValues'
  spec: {
    values: {
      [key: string]: KotsConfigValue
    }
  }
}

type KotsConfigProps = {
  pinnedCertificate: string
  stackSuffix?: string
}

async function getStackOutputValue(stackName: string, outputKey: string, dfault?: string): Promise<string> {
  let response
  try {
    response = await cloudformation.describeStacks({ StackName: stackName })
  } catch {
    throw new Error(
      `Stack ${stackName} not found in ${region}. Set the AWS_REGION environment variable if this region is incorrect, or pass a suffix with --stack-suffix.`
    )
  }

  const stack = response.Stacks?.[0]

  if (stack) {
    const output = stack.Outputs?.find((o: any) => o.OutputKey === outputKey)
    if (output) {
      return output.OutputValue!
    }
  }

  if (typeof dfault === 'undefined') throw new Error(`Output key "${outputKey}" not found in stack "${stackName}"`)

  return dfault
}

async function generateKotsConfig(props: KotsConfigProps): Promise<KotsConfig> {
  const stackName = (baseName: string) => `Wickr${baseName}${props.stackSuffix || ''}`

  const mysqlSecretArn = await getStackOutputValue(stackName('Rds'), 'DatabaseSecretArn')
  const mysqlSecret = await secretsmanager.getSecretValue({ SecretId: mysqlSecretArn })
  const mysqlPassword = JSON.parse(mysqlSecret.SecretString!).password

  return {
    apiVersion: 'kots.io/v1beta1',
    kind: 'ConfigValues',
    spec: {
      values: {
        hostname: {
          value: await getStackOutputValue(stackName('Acm'), 'DomainName'),
        },
        certificate_type: {
          value: 'certificate_type_acm',
        },
        acm_arn: {
          value: await getStackOutputValue(stackName('Acm'), 'CertificateArn'),
        },
        ingress_controller_service_type: {
          value: 'ingress_controller_service_type_clusterip',
        },
        ingress_controller_target_group_binding_arn: {
          value: await getStackOutputValue(stackName('Alb'), 'AlbTargetGroupArn'),
        },
        pinned_certificate_enabled: {
          value: '1',
        },
        pinned_certificate: {
          filename: 'pinned-cert.pem',
          value: Buffer.from(props.pinnedCertificate).toString('base64'),
        },
        mysql_host: {
          value: await getStackOutputValue(stackName('Rds'), 'DatabaseEndpoint'),
        },
        mysql_reader_host: {
          value: await getStackOutputValue(stackName('Rds'), 'DatabaseEndpointRO', ''),
        },
        mysql_user: {
          value: 'admin',
        },
        mysql_password: {
          valuePlaintext: mysqlPassword,
        },
        s3_bucket: {
          value: await getStackOutputValue(stackName('S3'), 'UploadBucketName'),
        },
        s3_region: {
          value: region,
        },
        s3_endpoint: {
          value: `s3.${region}.amazonaws.com`,
        },
        fileproxy_service_account_name: {
          value: 'fileproxy',
        },
        cluster_autoscaler_enabled: {
          value:  await getStackOutputValue(stackName('Eks'), 'ClusterAutoscalerEnabled', '0'),
        },
        cluster_autoscaler_service_account: {
          value: ((await getStackOutputValue(stackName('Eks'), 'ClusterAutoscalerEnabled', '0') == '1') ? 'cluster-autoscaler' : ''),
        },
        cluster_name: {
          value: await getStackOutputValue(stackName('Eks'), 'WickrEnterpriseEksClusterName'),
        },
        cluster_aws_region: {
          value: region,
        },
        cluster_cloud_provider: {
          value: 'cluster_cloud_provider_aws'
        },
      },
    },
  }
}

// An incredibly naive argument parser
// Use something more robust if we ever add more arguments
function parseArgs(): KotsConfigProps {
  const args = process.argv.slice(2)
  const props: KotsConfigProps = { pinnedCertificate: readFileSync(join(__dirname, '../lib/assets/certificate/amazon-ca.pem'), { encoding: 'utf8' }) }

  args.forEach((arg, i) => {
    if (arg === '--ca-file' && args[i+1]) {
      props.pinnedCertificate = readFileSync(args[i+1], {encoding: 'utf8'})
    } else if (arg === '--stack-suffix' && args[i+1]) {
      props.stackSuffix = args[i+1]
    }
  })

  return props
}

async function main(): Promise<KotsConfig> {
  return await generateKotsConfig(parseArgs())
}

main()
  .then((config) => console.log(JSON.stringify(config)))
  .catch(console.error)
