import * as aws from "@pulumi/aws";
import { config, options, suffix, tags } from "./config";

export const vpc = new aws.ec2.Vpc("globomatics", {
  cidrBlock: "10.42.0.0/16",
  enableDnsSupport: true,
  enableDnsHostnames: true,
  tags: tags(`vpc-${suffix}`),
}, options);
const availabilityZone = config.get("availabilityZone") ?? aws.getAvailabilityZonesOutput({
  state: "available",
}, options).names.apply(names => {
  if (!names.length) throw new Error("No hay zonas de disponibilidad disponibles.");
  return names[0];
});
export const subnet = new aws.ec2.Subnet("globomatics-public", {
  vpcId: vpc.id,
  cidrBlock: "10.42.1.0/24",
  availabilityZone,
  mapPublicIpOnLaunch: false,
  tags: tags(`subnet-publica-${suffix}`),
}, options);
const gateway = new aws.ec2.InternetGateway("globomatics", {
  vpcId: vpc.id,
  tags: tags(`igw-${suffix}`),
}, options);
export const routeTable = new aws.ec2.RouteTable("globomatics-public", {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }],
  tags: tags(`rtb-publica-${suffix}`),
}, options);
export const routeAssociation = new aws.ec2.RouteTableAssociation("globomatics-public", {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
}, options);
