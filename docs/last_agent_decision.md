# Quota Pay — Agentic Orchestrator Decision Audit

**Generated At:** `2026-11-18T12:35:54.232180+00:00`  
**Reasoning Engine:** `deterministic-nlu-fallback`  
**Selected Scenario:** `cloud_burst`  

---

## 1. Operator Prompt
> full aws cloud burst

---

## 2. Agent Reasoning
Operator requested full AWS / Cloud Burst execution. Placed all services on AWS `eu-south-1` Spot compute to handle public internet traffic independently of local Proxmox.

---

## 3. Live Cluster Telemetry Snapshot
```json
{
  "proxmox_reachable": true,
  "proxmox_host": "192.168.178.125",
  "proxmox_available_cores": 4,
  "proxmox_available_memory_mb": 2048,
  "aws_region": "eu-south-1",
  "aws_spot_hourly_usd": 0.005,
  "current_token_spend_usd": 0.0,
  "max_budget_usd": 5.0,
  "budget_remaining_usd": 5.0,
  "timestamp": "2026-11-18T12:35:54.229000+00:00"
}
```

---

## 4. Extracted Optimization Constraints
```json
{
  "max_hourly_budget_usd": 0.02,
  "max_latency_ms": 50.0,
  "prefer_edge": false,
  "allow_cloud_burst": true,
  "required_services": [
    "quota-ingress",
    "quota-web-frontend",
    "quota-ai-proxy"
  ],
  "objective": "max_availability_cloud_burst"
}
```

---

## 5. Synthesized FIGARO Placement Decision
```json
{
  "decision_id": "figaro-cloud_burst-20261118123554",
  "algorithm": "Quota-Agentic-FIGARO-Bridge",
  "objective": "max_availability_cloud_burst",
  "scenario": "cloud_burst",
  "allocations": [
    {
      "node_id": "cloud-burst-01",
      "target_provider": "aws",
      "target_node": "eu-south-1a",
      "cpu_cores": 2,
      "memory_mb": 2048,
      "services": [
        "quota-ingress",
        "quota-web-frontend",
        "quota-ai-proxy"
      ]
    }
  ],
  "estimated_cost_usd_hourly": 0.015,
  "estimated_latency_ms": 25.0,
  "timestamp": "2026-11-18T12:35:54.231807+00:00",
  "notes": "Operator requested full AWS / Cloud Burst execution. Placed all services on AWS `eu-south-1` Spot compute to handle public internet traffic independently of local Proxmox."
}
```

---

## 6. Serialized Terraform Inputs (`infra/terraform.tfvars.json`)
```json
{
  "placement_plan": {
    "cloud-burst-01": {
      "target_provider": "aws",
      "target_node": "eu-south-1a",
      "cpu_cores": 2,
      "memory_mb": 2048,
      "services": [
        "quota-ingress",
        "quota-web-frontend",
        "quota-ai-proxy"
      ]
    }
  }
}
```
