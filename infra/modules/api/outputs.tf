output "invoke_domain" {
  value = "${aws_api_gateway_rest_api.this.id}.execute-api.${data.aws_region.current.region}.amazonaws.com"
}

output "stage_name" {
  value = aws_api_gateway_stage.api.stage_name
}
