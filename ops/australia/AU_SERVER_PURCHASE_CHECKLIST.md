# Australia server purchase checklist

Evidence date: 2026-10-27. This is a purchase decision, not proof that an Australia host has been deployed.

## Buy this

Preferred provider/region: **AWS EC2 Asia Pacific (Sydney), `ap-southeast-2`**. AWS's current region catalogue explicitly lists Sydney with three Availability Zones. The current official Alibaba Cloud and Tencent Cloud region catalogues inspected today do not establish a Sydney compute region, so do not buy a product merely labelled “international” and assume it is in Australia.

Recommended launch configuration:

- Architecture: x86_64.
- Image: Ubuntu Server 24.04 LTS.
- Compute: general-purpose, non-burstable equivalent to 2 vCPU / 8 GiB; on AWS, `m6i.large` where offered.
- Minimum staging/small-pilot configuration: 2 vCPU / 4 GiB, 80 GiB encrypted SSD. A burstable `t3.medium` is acceptable for staging, not the preferred steady production shape.
- Disk: 100–120 GiB encrypted gp3 for production. Keep database, exports, logs and Docker data on persistent EBS.
- Network: VPC, public subnet, static Elastic IPv4, IPv6 optional, outbound HTTPS, security group.
- Security group inbound: 443 public; 80 public only for redirect/ACME; 22 only from the Owner/operator CIDR; **never expose 3001 or 3306**.
- Backups: daily application-level MySQL backup to a separate encrypted Sydney S3 bucket plus daily EBS snapshots with retention. Enable object versioning/lifecycle and a restore-test schedule.
- Monitoring: CloudWatch CPU/memory agent, disk alert at 70/80/90%, health endpoint monitoring, TLS expiry and backup-age alerts.

AWS does not automatically protect EBS data: its own documentation says regular snapshots or Data Lifecycle Manager/AWS Backup must be configured. A single disk is not a backup.

## Required purchase/account options

- Account billing and service quota confirmed for `ap-southeast-2`.
- One Elastic IP and one encrypted gp3 volume.
- IAM administrator path with MFA; a narrower deployment identity after bootstrap.
- S3 bucket explicitly created in Sydney; block public access; encryption enabled.
- Snapshot/DLM or AWS Backup plan explicitly enabled in Sydney.
- Provider console emergency access retained before SSH hardening.
- DNS control for `api.yiiling.cn`; create a separate staging record such as `au-api.yiiling.cn`.

The existing production mobile configuration uses `https://api.yiiling.cn`, not a hard-coded production IP. Retaining that hostname permits DNS cutover without forcing an OTA solely for the server move. A staging hostname is still required for pre-cutover testing. Lower the production A-record TTL to 300 seconds at least 24 hours before the authorized cutover.

## Do not buy

- 1 vCPU / 1 GiB, a disk smaller than 60 GiB, instance-store-only storage, or a tiny burstable instance as final production.
- ARM for this first migration. It may work, but changes architecture at the same time as region/data migration.
- A host without a stable public IPv4 if direct nginx/Let's Encrypt is the chosen path.
- A database advertised directly on public port 3306.
- “Sydney” capacity that the provider's current official region list does not verify.
- A prepaid term before the exact region, image, public IPv4, snapshot and refund constraints are checked in the purchase console.

## Capacity basis and limits

Read-only production observations show 4 vCPU / about 3.6 GiB RAM, a backend using about 74 MiB, MySQL about 509 MiB, and a Cairn database around 352 MiB. The 40 GB shared root disk is already about 92% full, so disk—not present Cairn CPU—is the immediate capacity risk. Nginx logs show roughly 2.3k–15k requests/day and a sampled peak of 267 requests/minute, but those figures include probes/scanners and are not authenticated user traffic. No live New Zealand-to-Sydney latency test has been performed.

## Official sources inspected 2026-10-27

- AWS regions, including Sydney `ap-southeast-2`: https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html
- AWS instance types by region: https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html
- AWS EBS snapshot responsibility: https://docs.aws.amazon.com/en_en/ebs/latest/userguide/ebs-snapshots.html
- AWS data location controls: https://aws.amazon.com/compliance/data-privacy-faq/
- Alibaba Cloud current ECS regions/zones: https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones
- Tencent Cloud current CVM regions/zones: https://www.tencentcloud.com/document/product/213/6091

Live prices, actual account availability, NZ latency and billing restrictions remain **OWNER_CONFIRM** in the provider console; this document intentionally does not invent them.
