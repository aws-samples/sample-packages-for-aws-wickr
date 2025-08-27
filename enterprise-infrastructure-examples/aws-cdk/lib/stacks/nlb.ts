import * as cdk from 'aws-cdk-lib'
import { IVpc, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2'
import {
  TargetType,
  Protocol,
  IpAddressType,
  NetworkLoadBalancer,
  NetworkTargetGroup,
  TargetGroupIpAddressType,
  ILoadBalancerV2,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Construct } from 'constructs'
import { tryGetHostedZone } from '../util'
import { ARecord, AaaaRecord, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager'

export interface NlbStackProps extends cdk.StackProps {
  vpc: IVpc
  certificate?: ICertificate
}

export class NlbStack extends cdk.Stack {
  readonly nlb: NetworkLoadBalancer
  readonly tcpTargetGroup: NetworkTargetGroup
  readonly udpTargetGroup: NetworkTargetGroup
  readonly httpsTargetGroup: NetworkTargetGroup
  readonly config: IWickrEnvironmentConfig

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, private readonly props: NlbStackProps) {
    super(scope, id, props)

    this.config = config
    const { vpc } = props

    this.tcpTargetGroup = new NetworkTargetGroup(this, 'WickrCallingTcpTargetGroup', {
      healthCheck: {
        enabled: true,
        interval: cdk.Duration.seconds(30),
        protocol: Protocol.TCP,
        timeout: cdk.Duration.seconds(2),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      port: 8443,
      protocol: Protocol.TCP,
      targetType: TargetType.IP,
      vpc,
    })

    this.udpTargetGroup = new NetworkTargetGroup(this, 'WickrCallingUdpTargetGroup', {
        healthCheck: {
          enabled: true,
          interval: cdk.Duration.seconds(30),
          protocol: Protocol.TCP, // health checks are TCP
          timeout: cdk.Duration.seconds(2),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
        },
        port: 16384,
        protocol: Protocol.UDP,
        targetType: TargetType.IP,
        ipAddressType: TargetGroupIpAddressType.IPV4,
        vpc,
      })

    const sg = new SecurityGroup(this, 'NlbCallingSecurityGroup', {
        description: 'NLB Calling Security Group',
        vpc: vpc,
      })

    this.nlb = new NetworkLoadBalancer(this, 'Nlb', {
      internetFacing: true,
      ipAddressType: IpAddressType.IPV4,
      vpc,
      vpcSubnets: {
        subnets: vpc.publicSubnets,
      },
      securityGroups: [sg],
      crossZoneEnabled: true
    })

    this.nlb.connections.allowTo(Peer.ipv4(vpc.vpcCidrBlock), Port.allTraffic())
    this.nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(443), 'Allow NLB messaging traffic')
    this.nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(8443), 'Allow NLB tcp calling traffic')
    this.nlb.connections.allowFrom(Peer.anyIpv4(), Port.udp(16384), 'Allow NLB udp calling traffic')

    this.nlb.addListener('TcpCallingListener', {
      defaultTargetGroups: [this.tcpTargetGroup],
      port: 8443,
      protocol: Protocol.TCP,
    })

    this.nlb.addListener('UdpCallingListener', {
        defaultTargetGroups: [this.udpTargetGroup],
        port: 16384,
        protocol: Protocol.UDP,
    })

    // HTTPS Traffc - Use this to route messaging traffic through the NLB rather than the ALB
    // this.httpsTargetGroup = new NetworkTargetGroup(this, 'NlbHttpsTargetGroup', {
    //   healthCheck: {
    //     enabled: true,
    //     interval: cdk.Duration.seconds(30),
    //     // This is an internal endpoint which the Nginx Ingress Controller exposes for liveness/readiness probes
    //     path: '/healthz',
    //     port: '10254',
    //     protocol: Protocol.HTTP,
    //     timeout: cdk.Duration.seconds(2),
    //     healthyThresholdCount: 2,
    //     unhealthyThresholdCount: 2,
    //   },
    //   port: 443,
    //   protocol: Protocol.TLS,
    //   targetType: TargetType.IP,
    //   vpc,
    // })

    // this.nlb.addListener('NlbHttpsListener', {
    //   certificates: props.certificate ? [props.certificate] : undefined,
    //   defaultTargetGroups: [this.httpsTargetGroup],
    //   port: 443,
    //   protocol: Protocol.TLS,
    //   sslPolicy: SslPolicy.TLS12_EXT,
    // })
    // new cdk.CfnOutput(this, 'NlbHttpsTargetGroupArn', {
    //   value: this.httpsTargetGroup.targetGroupArn,
    // })

    // Use this to create route 53 dns records for a custom domain
    // this.createDnsRecords(this.nlb, "changeme")

    new cdk.CfnOutput(this, 'NlbDnsName', {
      value: this.nlb.loadBalancerDnsName,
    })

    new cdk.CfnOutput(this, 'NlbTcpTargetGroupArn', {
      value: this.tcpTargetGroup.targetGroupArn,
    })

    new cdk.CfnOutput(this, 'NlbUdpTargetGroupArn', {
        value: this.udpTargetGroup.targetGroupArn,
    })

  }

  private createDnsRecords(lb: ILoadBalancerV2, domain: string) {
    const zone = tryGetHostedZone(this, this.config)

    if (zone) {
      // The recordName value must end with a period or it is created as a subdomain
      const recordName = domain.endsWith('.') ? domain : `${domain}.`
      const target = RecordTarget.fromAlias(new LoadBalancerTarget(lb))

      new ARecord(this, 'WickrNlbARecord', { zone, recordName, target })
      new AaaaRecord(this, 'WickrNlbAaaaRecord', { zone, recordName, target })
    }
  }
}
