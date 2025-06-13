import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib'
import { IKey } from 'aws-cdk-lib/aws-kms'
import { BlockPublicAccess, Bucket, StorageClass } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export interface S3StackProps extends StackProps {
  key: IKey
}

export class S3Stack extends Stack {
  readonly bucket: Bucket

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, props: S3StackProps) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'WickrUploads', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryptionKey: props.key,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(7),
          expiration: config.s3Expiration,
          transitions: [
            {
              storageClass: StorageClass.INTELLIGENT_TIERING,
              transitionAfter: Duration.days(0),
            },
          ],
        },
      ],
    })

    new CfnOutput(this, 'UploadBucketName', {
      value: this.bucket.bucketName,
    })

    new CfnOutput(this, 'UploadBucketArn', {
      value: this.bucket.bucketArn,
      description: 'Wickr Uploads Bucket ARN',
    })
  }
}
