package main

import rego.v1

deny contains sprintf("%s: salida global no permitida", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroupEgress"
  object.get(resource.Properties, "CidrIp", "") == "0.0.0.0/0"
}

deny contains sprintf("%s: salida IPv6 global no permitida", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroupEgress"
  object.get(resource.Properties, "CidrIpv6", "") == "::/0"
}

deny contains "Vpc: falta Flow Log de rechazos" if {
  flow := object.get(input.Resources, "VpcRejectFlowLog", {})
  props := object.get(flow, "Properties", {})
  object.get(props, "TrafficType", "") != "REJECT"
}

deny contains "ApprovedDownloads: solo se permiten destinos IPv4 /32" if {
  some entry in input.Resources.ApprovedDownloads.Properties.Entries
  not endswith(entry.Cidr, "/32")
}

# OPA no incluye estas politicas por defecto: son reglas del laboratorio.
deny contains sprintf("%s: IMDSv2 debe ser obligatorio", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::Instance"
  object.get(object.get(resource.Properties, "MetadataOptions", {}), "HttpTokens", "") != "required"
}

deny contains sprintf("%s: disco raiz sin cifrado explicito", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::Instance"
  some mapping in resource.Properties.BlockDeviceMappings
  object.get(mapping.Ebs, "Encrypted", false) != true
}

deny contains sprintf("%s: se requiere al menos un disco cifrado declarado", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::Instance"
  count(object.get(resource.Properties, "BlockDeviceMappings", [])) == 0
}

deny contains sprintf("%s: puertos administrativos expuestos a Internet", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroupIngress"
  object.get(resource.Properties, "CidrIp", "") == "0.0.0.0/0"
}

deny contains sprintf("%s: ingreso IPv6 global no permitido en el laboratorio", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroupIngress"
  object.get(resource.Properties, "CidrIpv6", "") == "::/0"
}

deny contains "BackendApi: debe autorizar solo al grupo del cliente" if {
  api := input.Resources.BackendApi.Properties
  object.get(api, "SourceSecurityGroupId", {}) != {"Fn::GetAtt": ["ClientSecurityGroup", "GroupId"]}
}

deny contains sprintf("%s: no abrir MySQL en un grupo de seguridad", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroupIngress"
  object.get(resource.Properties, "FromPort", 0) in {3306, 33060}
}

deny contains sprintf("%s: limitar creditos CPU a standard", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::Instance"
  object.get(object.get(resource.Properties, "CreditSpecification", {}), "CPUCredits", "") != "standard"
}

deny contains sprintf("%s: no permitir reglas inline de ingreso que eludan la revision", [name]) if {
  some name, resource in input.Resources
  resource.Type == "AWS::EC2::SecurityGroup"
  count(object.get(resource.Properties, "SecurityGroupIngress", [])) > 0
}

deny contains sprintf("%s: solo SSH y HTTP/HTTPS del operador con /32", [name]) if {
  name in {"SshIngressCidr", "WebIngressCidr"}
  parameter := input.Parameters[name]
  not endswith(object.get(parameter, "AllowedPattern", ""), "/32$")
}
