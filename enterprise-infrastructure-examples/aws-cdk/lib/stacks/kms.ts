import * as cdk from 'aws-cdk-lib'
import { IKey, Key } from 'aws-cdk-lib/aws-kms'
import { Construct } from 'constructs'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export class KmsStack extends cdk.Stack {
  readonly key: IKey

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig) {
    super(scope, id)

    if (config.importedKmsKeyArn) {
      this.key = Key.fromKeyArn(this, 'Key', config.importedKmsKeyArn)

    } else {
      this.key = new Key(this, 'Key', {
        description: 'Wickr Enterprise encryption key',
        enableKeyRotation: true,
      })
    }
  }
}
