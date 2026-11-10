output "instance_id" {
  value       = aws_instance.spot_node.id
  description = "AWS EC2 Spot instance ID"
}

output "public_ip" {
  value       = aws_instance.spot_node.public_ip
  description = "Public IPv4 address of the AWS Spot node"
}

output "spot_request_id" {
  value       = aws_instance.spot_node.spot_instance_request_id
  description = "AWS Spot Request ID"
}

output "services" {
  value       = var.services
  description = "Quota Pay services placed on this cloud node"
}

output "compose_target" {
  value       = var.compose_target
  description = "Docker Compose profile executed on this node"
}
