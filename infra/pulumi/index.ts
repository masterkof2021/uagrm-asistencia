import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { options, project, suffix, tags } from "./src/config";
import { client, backend } from "./src/compute";

new aws.resourcegroups.Group("globomatics", {
  name: `rg-${suffix}`,
  description: "Red y servidores de la aplicacion globomatics",
  resourceQuery: {
    type: "TAG_FILTERS_1_0",
    query: JSON.stringify({
      ResourceTypeFilters: ["AWS::AllSupported"],
      TagFilters: [{ Key: "Project", Values: [project] }],
    }),
  },
  tags: tags(`rg-${suffix}`),
}, options);
export const servers = {
  client: { id: client.id, public_ip: client.publicIp, public_dns: client.publicDns, private_ip: client.privateIp },
  backend: { id: backend.id, public_ip: backend.publicIp, private_ip: backend.privateIp },
};
export const ssh_commands = {
  client: pulumi.interpolate`ssh -i ~/globomatics-ec2 ec2-user@${client.publicIp}`,
  backend: pulumi.interpolate`ssh -i ~/globomatics-ec2 ec2-user@${backend.publicIp}`,
};
