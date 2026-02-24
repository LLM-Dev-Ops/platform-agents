/**
 * Shared text-analysis utilities used by all agents in heuristic (no-API-key) mode.
 * Extracts structured information from the objective string so that agents can
 * produce contextual, domain-specific output instead of canned responses.
 */

export interface TextAnalysis {
  /** Key topics / noun-phrases extracted from the objective */
  topics: string[];
  /** Primary domain: technology | business | operations | compliance | strategy */
  domain: string;
  /** Action type: migration | implementation | evaluation | optimization | transformation | integration | general */
  actionType: string;
  /** Named entities (technologies, products, standards) */
  entities: string[];
  /** Detected constraints (timeline, budget, regulatory, resources) */
  constraints: string[];
  /** Risk signals present in the text */
  riskSignals: string[];
  /** Positive / opportunity signals */
  positiveSignals: string[];
  /** Overall complexity assessment */
  complexity: "low" | "medium" | "high";
  /** Word count */
  wordCount: number;
  /** Individual sentences */
  sentences: string[];
}

// ---------------------------------------------------------------------------
// Entity / keyword dictionaries
// ---------------------------------------------------------------------------

const TECH_ENTITIES_RE =
  /\b(AWS|Amazon Web Services|Azure|GCP|Google Cloud|Kubernetes|K8s|Docker|PostgreSQL|Postgres|MySQL|MariaDB|MongoDB|Redis|Kafka|Elasticsearch|Grafana|Prometheus|Datadog|Splunk|Terraform|Ansible|Jenkins|GitHub Actions|GitLab CI|CircleCI|Snowflake|Databricks|BigQuery|Redshift|S3|EC2|Lambda|RDS|Aurora|DynamoDB|ECS|EKS|Fargate|SageMaker|Cloud Run|Cloud Functions|Vercel|Netlify|Cloudflare|Nginx|Apache|React|Angular|Vue|Next\.js|Node\.js|Python|Java|Go|Rust|TypeScript|JavaScript|\.NET|C#|Ruby|Rails|Django|Flask|Spring|Kotlin|Swift|Flutter|React Native|TensorFlow|PyTorch|OpenAI|LLM|GPT|ML|AI|CI\/CD|microservices|monolith|serverless|containerization|API gateway|load balancer|CDN|VPC|VPN|IAM|SSO|OAuth|JWT|GraphQL|REST|gRPC|WebSocket|message queue|event-driven|data lake|data warehouse|ETL|ELT|data pipeline|Airflow|dbt|Fivetran|Looker|Tableau|Power BI|SAP|Salesforce|Workday|ServiceNow|Oracle|SQL Server|Cassandra|Neo4j|InfluxDB)\b/gi;

const COMPLIANCE_ENTITIES_RE =
  /\b(PCI[\s-]?DSS|PCI|HIPAA|GDPR|SOC\s*2|SOX|CCPA|FERPA|ISO[\s-]?27001|NIST|FedRAMP|FISMA|HITRUST|ITAR|EAR|AML|KYC|Basel\s*III|MiFID|PSD2|DORA)\b/gi;

// ---------------------------------------------------------------------------
// Domain detection
// ---------------------------------------------------------------------------

const DOMAIN_SIGNALS: Record<string, RegExp[]> = {
  technology: [
    /\b(migrat\w*|deploy\w*|architect\w*|infrastruct\w*|server\w*|database|API|backend|frontend|devops|cloud\w*|platform|system\w*|software|code\w*|application|service\w*|container\w*|cluster|pipeline|CI\/CD|microservice\w*)/i,
  ],
  compliance: [
    /\b(compliance|regulat\w*|audit\w*|governance|privacy|data protection|security standard|certific\w*|accreditat\w*|PCI|HIPAA|GDPR|SOC|SOX)/i,
  ],
  business: [
    /\b(revenue|profit\w*|market\w*|customer\w*|sales|pricing|ROI|cost.?benefit|business model|go.?to.?market|acquisition|retention|churn|growth strategy|competitive|monetiz\w*)/i,
  ],
  operations: [
    /\b(process\w*|workflow\w*|team\w*|staffing|hiring|on.?boarding|SLA|incident|monitoring|support|operations|capacity|resource allocation|vendor management|procurement)/i,
  ],
  strategy: [
    /\b(strateg\w*|roadmap|vision|long.?term|initiative|transform\w*|digital transformation|moderniz\w*|consolidat\w*|re.?org\w*|merger|acquisition|partnership)/i,
  ],
};

function detectDomain(text: string): string {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [domain, patterns] of Object.entries(DOMAIN_SIGNALS)) {
    scores[domain] = patterns.reduce(
      (n, re) => n + (lower.match(re) || []).length,
      0
    );
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "general";
}

// ---------------------------------------------------------------------------
// Action type detection
// ---------------------------------------------------------------------------

const ACTION_MAP: [string, RegExp][] = [
  ["migration", /\b(migrat\w*|move\s+to|transition\s+to|switch\s+to|convert\s+from|port\s+to|transfer\w*)/i],
  ["integration", /\b(integrat\w*|connect\w*|unif\w*|merg\w*|consolidat\w*|interop\w*)/i],
  ["implementation", /\b(implement\w*|build\w*|creat\w*|develop\w*|deploy\w*|launch\w*|set\s*up|establish\w*|introduc\w*|adopt\w*)/i],
  ["optimization", /\b(optimiz\w*|improv\w*|enhanc\w*|streamlin\w*|refactor\w*|accelerat\w*|reduc\w*|automat\w*|scal\w*)/i],
  ["transformation", /\b(transform\w*|moderniz\w*|overhaul\w*|redesign\w*|re.?engineer\w*|re.?architect\w*|re.?platform\w*)/i],
  ["evaluation", /\b(evaluat\w*|assess\w*|review\w*|analyz\w*|audit\w*|benchmark\w*|compar\w*|investigat\w*|feasibility)/i],
];

function detectActionType(text: string): string {
  for (const [action, re] of ACTION_MAP) {
    if (re.test(text)) return action;
  }
  return "general";
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

function extractEntities(text: string): string[] {
  const techMatches = text.match(TECH_ENTITIES_RE) || [];
  const complianceMatches = text.match(COMPLIANCE_ENTITIES_RE) || [];
  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of [...techMatches, ...complianceMatches]) {
    const key = m.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Topic extraction (simple noun-phrase heuristic)
// ---------------------------------------------------------------------------

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  // Look for "X to Y" patterns (common in migration/transition objectives)
  const toPatterns = text.match(/\b(\w[\w\s]*?)\s+to\s+(\w[\w\s]*?)(?:\s+(?:while|with|for|and|by|using|during|in)\b|[,.]|$)/gi);
  if (toPatterns) {
    for (const p of toPatterns) {
      const clean = p.replace(/\s+(while|with|for|and|by|using|during|in).*$/i, "").trim();
      if (clean.length > 3 && clean.length < 80) topics.push(clean);
    }
  }
  // Extract phrases between commas/semicolons that look like topics
  const clauses = text.split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 5 && s.length < 100);
  for (const clause of clauses) {
    if (!topics.some((t) => t.includes(clause) || clause.includes(t))) {
      topics.push(clause);
    }
  }
  // If no topics extracted, use the whole objective
  if (topics.length === 0) {
    topics.push(text.length > 120 ? text.slice(0, 120) + "..." : text);
  }
  return topics.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Risk / constraint / positive signal detection
// ---------------------------------------------------------------------------

const RISK_SIGNAL_PATTERNS: [string, RegExp][] = [
  ["tight timeline pressure", /\b(urgent\w*|deadline|time.?critical|accelerat\w*|fast.?track\w*|rush\w*|asap|immediate\w*|tight timeline)/i],
  ["resource constraints", /\b(limited|constrained|shortage|scarce|understaffed|lean team|budget.?cut|reduced budget)/i],
  ["technical complexity", /\b(complex\w*|large.?scale|enterprise.?wide|multi.?system|cross.?platform|heterogeneous|legacy)/i],
  ["uncertainty or unproven approach", /\b(uncertain\w*|unproven|experimental|prototype\w*|novel|cutting.?edge|bleeding.?edge|untested|unknown)/i],
  ["vendor/third-party dependency", /\b(vendor\w*|third.?party|external provider|partner dependency|outsourc\w*|contractor)/i],
  ["regulatory/compliance exposure", /\b(regulat\w*|compliance|audit\w*|legal\w*|GDPR|HIPAA|PCI|SOX|privacy|data protection)/i],
  ["data integrity/migration risk", /\b(data migration|data loss|data integrity|data quality|data conversion|ETL)/i],
  ["security exposure", /\b(security|vulnerabilit\w*|breach\w*|attack surface|threat\w*|encryption|access control|authentication)/i],
  ["organizational change risk", /\b(reorg\w*|restructur\w*|culture change|change management|adoption|resistance|training gap)/i],
  ["scope creep potential", /\b(scope\w*|requirements? change|feature creep|moving target|evolving requirements)/i],
];

function detectRiskSignals(text: string): string[] {
  return RISK_SIGNAL_PATTERNS
    .filter(([, re]) => re.test(text))
    .map(([label]) => label);
}

const CONSTRAINT_PATTERNS: [string, RegExp][] = [
  ["timeline constraint", /\b(deadline|by Q[1-4]|by end of|within \d+|before \w+ \d{4}|timeline|time.?bound)/i],
  ["budget constraint", /\b(budget\w*|cost\w*|funding|financial\w*|expenditure|\$\d|spend\w*|investment cap)/i],
  ["regulatory requirement", /\b(compliance|regulat\w*|must comply|legal requirement|mandate\w*|certific\w*)/i],
  ["resource limitation", /\b(limited team|small team|existing staff|no additional|headcount|bandwidth)/i],
  ["backward compatibility", /\b(backward.?compat\w*|legacy support|existing users|migration path|non.?breaking)/i],
  ["performance requirement", /\b(latency|throughput|uptime|SLA|99\.\d+%|response time|availability)/i],
];

function detectConstraints(text: string): string[] {
  return CONSTRAINT_PATTERNS
    .filter(([, re]) => re.test(text))
    .map(([label]) => label);
}

const POSITIVE_PATTERNS: [string, RegExp][] = [
  ["proven technology", /\b(proven|established|mature|stable|battle.?tested|industry.?standard|well.?known)/i],
  ["strategic alignment", /\b(strateg\w*|aligns? with|supports? our|in line with|roadmap|vision)/i],
  ["efficiency gain", /\b(automat\w*|streamlin\w*|efficien\w*|faster|reduc\w* time|reduc\w* cost|sav\w*|eliminat\w* manual)/i],
  ["competitive advantage", /\b(competitive|market.?lead\w*|differentiat\w*|first.?mover|innovati\w*|ahead of)/i],
  ["team readiness", /\b(experienced team|skilled|expertise|trained|proficient|capable|strong team)/i],
];

function detectPositiveSignals(text: string): string[] {
  return POSITIVE_PATTERNS
    .filter(([, re]) => re.test(text))
    .map(([label]) => label);
}

// ---------------------------------------------------------------------------
// Complexity assessment
// ---------------------------------------------------------------------------

function assessComplexity(
  wordCount: number,
  entityCount: number,
  riskCount: number,
  constraintCount: number
): "low" | "medium" | "high" {
  const score = wordCount * 0.3 + entityCount * 8 + riskCount * 10 + constraintCount * 7;
  if (score > 60) return "high";
  if (score > 25) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export function analyzeText(objective: string): TextAnalysis {
  const sentences = objective
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const wordCount = objective.split(/\s+/).filter(Boolean).length;
  const entities = extractEntities(objective);
  const riskSignals = detectRiskSignals(objective);
  const constraints = detectConstraints(objective);
  const positiveSignals = detectPositiveSignals(objective);

  return {
    topics: extractTopics(objective),
    domain: detectDomain(objective),
    actionType: detectActionType(objective),
    entities,
    constraints,
    riskSignals,
    positiveSignals,
    complexity: assessComplexity(wordCount, entities.length, riskSignals.length, constraints.length),
    wordCount,
    sentences: sentences.length > 0 ? sentences : [objective],
  };
}
