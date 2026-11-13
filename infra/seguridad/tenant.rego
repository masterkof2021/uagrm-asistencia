package main

import rego.v1

deny contains "CAPAS-001" if {
  count(input.instancias) != 3
}

deny contains sprintf("EC2-IMDSV2:%s", [instancia.id]) if {
  some instancia in input.instancias
  instancia.comprobar_configuracion
  instancia.imdsv2 != true
}

deny contains sprintf("EBS-CIFRADO:%s", [instancia.id]) if {
  some instancia in input.instancias
  instancia.comprobar_configuracion
  instancia.cifrado != true
}
