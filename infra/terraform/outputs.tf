output "server_public_ip" {
  description = "Public IPv4 address of the Quota Pay Spot EC2 instance in eu-south-1"
  value       = aws_instance.quota_spot_server.public_ip
}

output "instance_id" {
  description = "EC2 Spot Instance ID in eu-south-1"
  value       = aws_instance.quota_spot_server.id
}

