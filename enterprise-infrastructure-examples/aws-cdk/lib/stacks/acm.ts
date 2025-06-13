import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { tryGetHostedZone } from '../util'
import { IHostedZone } from 'aws-cdk-lib/aws-route53'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export class AcmStack extends cdk.Stack {
  readonly certificate?: ICertificate

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, zone?: IHostedZone) {
    super(scope, id)

    const importedCertArn = config.importedCertArn
    const domain = config.domain
    zone = zone ?? tryGetHostedZone(this, config)

    if (importedCertArn) {
      this.certificate = Certificate.fromCertificateArn(this, 'Certificate', importedCertArn)
    } else if (zone && domain) {
      this.certificate = new Certificate(this, 'Certificate', {
        domainName: domain,
        validation: CertificateValidation.fromDns(zone),
      })
    }

    if (this.certificate) {
      new cdk.CfnOutput(this, 'CertificateArn', {
        value: this.certificate!.certificateArn,
      })

      new cdk.CfnOutput(this, 'DomainName', {
        value: domain,
      })
    }
  }
}
