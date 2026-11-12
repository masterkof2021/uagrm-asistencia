import * as aws from "@pulumi/aws";
import { config, options, publicKey, suffix, tags } from "./config";
import { routeAssociation, subnet } from "./network";
import { backendSecurityGroup, clientSecurityGroup } from "./security";

const clientAmiId = config.get("clientAmiId");
const backendAmiId = config.get("backendAmiId");
const latestAmi = clientAmiId && backendAmiId ? undefined : aws.ssm.getParameterOutput({
  name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.18-x86_64",
}, options).value;
export const keyPair = new aws.ec2.KeyPair("globomatics", {
  keyName: `key-${suffix}`,
  publicKey,
  tags: tags(`key-${suffix}`),
}, options);
function server(role: "client" | "backend", privateIp: string, volumeSize: number) {
  const label = role === "client" ? "cliente" : "backend";
  return new aws.ec2.Instance(`globomatics-${role}`, {
    ami: (role === "client" ? clientAmiId : backendAmiId) ?? latestAmi!,
    instanceType: "t3.micro",
    subnetId: subnet.id,
    privateIp,
    associatePublicIpAddress: true,
    keyName: keyPair.keyName,
    vpcSecurityGroupIds: [(role === "client" ? clientSecurityGroup : backendSecurityGroup).id],
    metadataOptions: { httpEndpoint: "enabled", httpTokens: "required" },
    rootBlockDevice: {
      volumeType: "gp3", volumeSize, encrypted: true, deleteOnTermination: true,
      tags: tags(`ebs-${label}-root-${suffix}`),
    },
    tags: { ...tags(`ec2-${label}-${suffix}`), Role: role },
  }, { ...options, dependsOn: [routeAssociation] });
}
export const client = server("client", "10.42.1.10", 12);
export const backend = server("backend", "10.42.1.20", 20);
