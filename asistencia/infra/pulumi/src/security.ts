import * as aws from "@pulumi/aws";
import { options, sshSourceCidr, suffix, tags } from "./config";
import { vpc } from "./network";

export const clientSecurityGroup = new aws.ec2.SecurityGroup("globomatics-client", {
  name: `secgrp-cliente-${suffix}`,
  description: "Cliente HTTP/HTTPS publico; SSH solo desde la IP administrativa",
  vpcId: vpc.id,
  tags: tags(`secgrp-cliente-${suffix}`),
}, options);
export const backendSecurityGroup = new aws.ec2.SecurityGroup("globomatics-backend", {
  name: `secgrp-backend-${suffix}`,
  description: "API solo desde cliente; SSH solo desde la IP administrativa; sin acceso a BD",
  vpcId: vpc.id,
  tags: tags(`secgrp-backend-${suffix}`),
}, options);
for (const [role, group] of Object.entries({ client: clientSecurityGroup, backend: backendSecurityGroup })) {
  new aws.vpc.SecurityGroupIngressRule(`globomatics-ssh-${role}`, {
    securityGroupId: group.id,
    description: "SSH desde la IP administrativa",
    cidrIpv4: sshSourceCidr,
    ipProtocol: "tcp", fromPort: 22, toPort: 22,
    tags: tags(`sgr-ingress-${role}-ssh-${suffix}`),
  }, options);
  new aws.vpc.SecurityGroupEgressRule(`globomatics-outbound-${role}`, {
    securityGroupId: group.id,
    description: "Salida para actualizaciones y configuracion",
    cidrIpv4: "0.0.0.0/0", ipProtocol: "-1",
    tags: tags(`sgr-egress-${role}-${suffix}`),
  }, options);
}
for (const [protocol, port] of Object.entries({ http: 80, https: 443 })) {
  new aws.vpc.SecurityGroupIngressRule(`globomatics-web-${protocol}`, {
    securityGroupId: clientSecurityGroup.id,
    description: `Acceso web publico ${protocol}`,
    cidrIpv4: "0.0.0.0/0",
    ipProtocol: "tcp", fromPort: port, toPort: port,
    tags: tags(`sgr-ingress-cliente-${protocol}-${suffix}`),
  }, options);
}
new aws.vpc.SecurityGroupIngressRule("globomatics-api", {
  securityGroupId: backendSecurityGroup.id,
  description: "TCP 8090 por IP privada desde el servidor cliente",
  referencedSecurityGroupId: clientSecurityGroup.id,
  ipProtocol: "tcp", fromPort: 8090, toPort: 8090,
  tags: tags(`sgr-ingress-backend-api-${suffix}`),
}, options);
