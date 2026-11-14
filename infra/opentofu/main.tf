terraform {
  required_version = ">= 1.11, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region              = "us-east-2"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "proyecto-final-modulo-2"
      Tenant      = var.tenant_id
      Environment = var.environment
      ManagedBy   = "OpenTofu"
    }
  }
}

locals {
  name = "pfm2-${var.tenant_id}"
  catalog = {
    for plan in jsondecode(file("${path.module}/../../plataforma/planes.json")) : plan.id => plan
  }
  roles = {
    Frontend = "frontend"
    Backend  = "backend"
    MySQL    = "database"
  }
  vpc_cidr    = "10.248.0.0/16"
  subnet_cidr = cidrsubnet(local.vpc_cidr, 8, 1)
  addresses = {
    frontend = cidrhost(local.subnet_cidr, 10)
    backend  = cidrhost(local.subnet_cidr, 20)
    database = cidrhost(local.subnet_cidr, 30)
  }
  servers = {
    for spec in local.catalog[var.plan].recursos : local.roles[spec.rol] => spec
  }
  links = {
    api   = { from = "frontend", to = "backend", port = 8090 }
    mysql = { from = "backend", to = "database", port = 3306 }
  }
  secrets = {
    backend  = ["db", "admin"]
    database = ["db"]
  }
  use_ssm = var.operator_cidr == null
  profile_roles = {
    for role, secrets in merge(local.secrets, { frontend = [] }) :
    role => tolist(secrets) if local.use_ssm || role != "frontend"
  }
  parameter_prefix = "/asistencia/proyecto-final-modulo-2/${var.tenant_id}"
}

resource "aws_vpc" "tenant" {
  cidr_block           = local.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_subnet" "tenant" {
  vpc_id            = aws_vpc.tenant.id
  cidr_block        = local.subnet_cidr
  availability_zone = var.availability_zone
  tags              = { Name = local.name }
}

resource "aws_internet_gateway" "tenant" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = local.name }
}

resource "aws_route_table" "tenant" {
  vpc_id = aws_vpc.tenant.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.tenant.id
  }
  tags = { Name = local.name }
}

resource "aws_route_table_association" "tenant" {
  subnet_id      = aws_subnet.tenant.id
  route_table_id = aws_route_table.tenant.id
}

resource "aws_security_group" "server" {
  for_each    = local.servers
  name_prefix = "${local.name}-${each.key}-"
  description = "Acceso del rol ${each.key} del tenant"
  vpc_id      = aws_vpc.tenant.id
  tags        = { Name = "${local.name}-${each.key}" }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each          = local.use_ssm ? {} : local.servers
  security_group_id = aws_security_group.server[each.key].id
  cidr_ipv4         = var.operator_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "internal" {
  for_each                     = local.links
  security_group_id            = aws_security_group.server[each.value.to].id
  referenced_security_group_id = aws_security_group.server[each.value.from].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "internal" {
  for_each                     = local.links
  security_group_id            = aws_security_group.server[each.value.from].id
  referenced_security_group_id = aws_security_group.server[each.value.to].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "https" {
  for_each          = local.servers
  security_group_id = aws_security_group.server[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_key_pair" "operator" {
  count      = local.use_ssm ? 0 : 1
  key_name   = "${local.name}-ssh"
  public_key = var.ssh_public_key
}

ephemeral "random_password" "bootstrap" {
  for_each = toset(["db", "admin"])
  length   = 48
  special  = false
}

resource "aws_ssm_parameter" "bootstrap" {
  for_each         = toset(["db", "admin"])
  name             = "${local.parameter_prefix}/${each.key}"
  type             = "SecureString"
  tier             = "Standard"
  value_wo         = ephemeral.random_password.bootstrap[each.key].result
  value_wo_version = 1
}

resource "aws_iam_role" "bootstrap" {
  for_each             = local.profile_roles
  name                 = "${local.name}-${each.key}"
  path                 = "/proyecto-final-modulo-2/"
  permissions_boundary = var.permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "parameters" {
  for_each = local.secrets
  name     = "ReadTenantBootstrap"
  role     = aws_iam_role.bootstrap[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = [for secret in each.value : aws_ssm_parameter.bootstrap[secret].arn]
    }]
  })
}

resource "aws_iam_instance_profile" "bootstrap" {
  for_each = local.profile_roles
  name     = "${local.name}-${each.key}"
  path     = "/proyecto-final-modulo-2/"
  role     = aws_iam_role.bootstrap[each.key].name
}

resource "aws_iam_role_policy" "ssm_agent" {
  for_each = local.use_ssm ? local.profile_roles : {}
  name     = "ManagedInstanceChannels"
  role     = aws_iam_role.bootstrap[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_instance" "server" {
  for_each                    = local.servers
  ami                         = var.ami_id
  instance_type               = each.value.instancia
  subnet_id                   = aws_subnet.tenant.id
  private_ip                  = local.addresses[each.key]
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.server[each.key].id]
  key_name                    = try(aws_key_pair.operator[0].key_name, null)
  iam_instance_profile        = try(aws_iam_instance_profile.bootstrap[each.key].name, null)

  user_data = replace(join("\n", [
    templatefile("${path.module}/cloud-init/common.sh.tftpl", {
      app_commit       = var.app_commit
      parameter_prefix = local.parameter_prefix
      frontend_ip      = local.addresses.frontend
      backend_ip       = local.addresses.backend
      database_ip      = local.addresses.database
      web_origin       = var.web_origin
      read_secret_command = chomp(<<-EOT
        aws ssm get-parameter --region us-east-2 --with-decryption \
                --name "$parameter_prefix/$1" --query Parameter.Value --output text
      EOT
      )
    }),
    var.use_ansible ? join("\n", concat(
      each.key == "frontend" ? [] : [
        trimspace(file("${path.module}/cloud-init/capa.sh")),
        trimspace(file("${path.module}/cloud-init/${each.key}.sh")),
        "PFM2_CAPA",
      ],
      [
        "pfm2_rol=${each.key}",
        trimspace(file("${path.module}/cloud-init/ansible.sh")),
        trimspace(file("${path.module}/cloud-init/${each.key}.yml")),
        file("${path.module}/cloud-init/ejecutar-ansible.sh"),
      ],
    )) : file("${path.module}/cloud-init/${each.key}.sh"),
  ]), "\r\n", "\n")

  credit_specification {
    cpu_credits = "standard"
  }
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = each.value.discoGiB
    encrypted             = true
    delete_on_termination = true
    tags                  = { Name = "${local.name}-${each.key}" }
  }

  tags = { Name = "${local.name}-${each.key}", Role = each.key }
  lifecycle {
    precondition {
      condition     = (var.operator_cidr == null) == (var.ssh_public_key == null)
      error_message = "Configura la IPv4 y la clave pública juntas, u omite ambas para usar Systems Manager."
    }
  }
  depends_on = [
    aws_route_table_association.tenant,
    aws_vpc_security_group_ingress_rule.internal,
    aws_vpc_security_group_egress_rule.internal,
    aws_vpc_security_group_egress_rule.https,
    aws_iam_role_policy.parameters,
    aws_iam_role_policy.ssm_agent,
  ]
}

output "instances" {
  description = "Instancias del tenant para verificación, suspensión y reanudación."
  value = {
    for role, instance in aws_instance.server : role => {
      id         = instance.id
      private_ip = instance.private_ip
      public_ip  = instance.public_ip
    }
  }
}

output "deployment" {
  value = { tenant_id = var.tenant_id, plan = var.plan, app_commit = var.app_commit, vpc_id = aws_vpc.tenant.id }
}
