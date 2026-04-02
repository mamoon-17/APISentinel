import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { MethodBadge } from './MethodBadge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { mockSpecDetails } from '@/data/specDetails';
import { HttpMethod } from '@/types/api';

interface ViolationDiffLine {
  type: 'match' | 'error' | 'warning' | 'missing';
  line: string;
}

interface EndpointViolation {
  endpointId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  violationType: 'type_mismatch' | 'extra_field' | 'missing_field' | 'multiple';
  violationCount: number;
  expected: ViolationDiffLine[];
  received: ViolationDiffLine[];
}

// Generate mock violations based on actual spec endpoints
function getViolationsForSpec(specId: string): EndpointViolation[] {
  const spec = mockSpecDetails[specId];
  if (!spec) return [];

  const violations: EndpointViolation[] = [];

  // Only endpoints that have been called can have violations
  const calledEndpoints = spec.endpoints.filter((ep) => ep.called);

  // Simulate violations on some called endpoints
  if (specId === '1') {
    const ep2 = calledEndpoints.find((e) => e.id === 'e2');
    if (ep2) {
      violations.push({
        endpointId: ep2.id,
        method: ep2.method,
        path: ep2.path,
        summary: ep2.summary,
        violationType: 'multiple',
        violationCount: 3,
        expected: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "id": "string",' },
          { type: 'match', line: '  "name": "string",' },
          { type: 'missing', line: '  "email": "string",' },
          { type: 'error', line: '  "age": "number"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "id": "string",' },
          { type: 'match', line: '  "name": "string",' },
          { type: 'missing', line: '' },
          { type: 'error', line: '  "age": "42",' },
          { type: 'warning', line: '  "metadata": { "debug": {} }' },
          { type: 'match', line: '}' },
        ],
      });
    }

    const ep8 = calledEndpoints.find((e) => e.id === 'e8');
    if (ep8) {
      violations.push({
        endpointId: ep8.id,
        method: ep8.method,
        path: ep8.path,
        summary: ep8.summary,
        violationType: 'extra_field',
        violationCount: 1,
        expected: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "token": "string",' },
          { type: 'match', line: '  "expiresIn": "number"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "token": "string",' },
          { type: 'match', line: '  "expiresIn": "number",' },
          { type: 'warning', line: '  "refreshToken": "string",' },
          { type: 'warning', line: '  "sessionId": "string"' },
          { type: 'match', line: '}' },
        ],
      });
    }

    const ep6 = calledEndpoints.find((e) => e.id === 'e6');
    if (ep6) {
      violations.push({
        endpointId: ep6.id,
        method: ep6.method,
        path: ep6.path,
        summary: ep6.summary,
        violationType: 'type_mismatch',
        violationCount: 1,
        expected: [
          { type: 'match', line: '{' },
          { type: 'error', line: '  "bio": "string",' },
          { type: 'match', line: '  "avatar": "string"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'error', line: '  "bio": null,' },
          { type: 'match', line: '  "avatar": "string"' },
          { type: 'match', line: '}' },
        ],
      });
    }
  }

  if (specId === '2') {
    const ep3 = spec.endpoints.find((e) => e.id === 'o3');
    if (ep3 && ep3.called) {
      violations.push({
        endpointId: ep3.id,
        method: ep3.method,
        path: ep3.path,
        summary: ep3.summary,
        violationType: 'missing_field',
        violationCount: 2,
        expected: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "id": "string",' },
          { type: 'match', line: '  "items": "array",' },
          { type: 'missing', line: '  "total": "number"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "id": "string",' },
          { type: 'match', line: '  "items": "array",' },
          { type: 'missing', line: '' },
          { type: 'warning', line: '  "subtotal": "number",' },
          { type: 'warning', line: '  "tax": "number"' },
          { type: 'match', line: '}' },
        ],
      });
    }

    const ep10 = spec.endpoints.find((e) => e.id === 'o10');
    if (ep10 && ep10.called) {
      violations.push({
        endpointId: ep10.id,
        method: ep10.method,
        path: ep10.path,
        summary: ep10.summary,
        violationType: 'type_mismatch',
        violationCount: 1,
        expected: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "transactionId": "string",' },
          { type: 'error', line: '  "status": "string"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "transactionId": "string",' },
          { type: 'error', line: '  "status": 1' },
          { type: 'match', line: '}' },
        ],
      });
    }
  }

  if (specId === '3') {
    const ep1 = spec.endpoints.find((e) => e.id === 'l1');
    if (ep1 && ep1.called) {
      violations.push({
        endpointId: ep1.id,
        method: ep1.method,
        path: ep1.path,
        summary: ep1.summary,
        violationType: 'extra_field',
        violationCount: 1,
        expected: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "chargeId": "string"' },
          { type: 'match', line: '}' },
        ],
        received: [
          { type: 'match', line: '{' },
          { type: 'match', line: '  "chargeId": "string",' },
          { type: 'warning', line: '  "legacyId": "number",' },
          { type: 'warning', line: '  "deprecated": true' },
          { type: 'match', line: '}' },
        ],
      });
    }
  }

  return violations;
}

const lineStyles = {
  match: 'text-foreground',
  error: 'text-destructive bg-destructive/10',
  warning: 'text-warning bg-warning/10',
  missing: 'text-muted-foreground bg-muted/30 line-through',
};

const violationLabels: Record<string, { label: string; variant: 'destructive' | 'default' }> = {
  type_mismatch: { label: 'Type Mismatch', variant: 'destructive' },
  extra_field: { label: 'Extra Field', variant: 'default' },
  missing_field: { label: 'Missing Field', variant: 'destructive' },
  multiple: { label: 'Multiple Issues', variant: 'destructive' },
};

interface SchemaViolationsProps {
  specId: string;
}

export function SchemaViolations({ specId }: SchemaViolationsProps) {
  const violations = getViolationsForSpec(specId);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="card-gradient rounded-lg border border-border p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2 bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {violations.length} Endpoint{violations.length !== 1 ? 's' : ''} with Violations
            </h3>
            <p className="text-sm text-muted-foreground">
              Endpoints returning responses inconsistent with the OpenAPI specification
            </p>
          </div>
        </div>
        <p className="text-3xl font-bold font-mono text-destructive">{violations.length}</p>
      </div>

      {violations.length === 0 ? (
        <div className="card-gradient rounded-lg border border-success/30 p-8 text-center">
          <Check className="h-8 w-8 text-success mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">All Clear</h3>
          <p className="text-sm text-muted-foreground">No schema violations detected for this specification.</p>
        </div>
      ) : (
        <div className="card-gradient rounded-lg border border-border overflow-hidden divide-y divide-border">
          {violations.map((v) => {
            const isExpanded = expandedIds.includes(v.endpointId);
            const info = violationLabels[v.violationType];

            return (
              <div key={v.endpointId}>
                <div
                  className="flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => {
                    setExpandedIds((prev) =>
                      prev.includes(v.endpointId)
                        ? prev.filter((id) => id !== v.endpointId)
                        : [...prev, v.endpointId]
                    );
                  }}
                >
                  <button className="text-muted-foreground shrink-0">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <MethodBadge method={v.method} />
                  <span className="font-mono text-sm text-foreground flex-1 truncate">{v.path}</span>
                  <span className="text-sm text-muted-foreground hidden sm:block max-w-[180px] truncate">{v.summary}</span>
                  <Badge variant={info.variant} className="text-xs shrink-0">{info.label}</Badge>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    {v.violationCount} issue{v.violationCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {isExpanded && (
                  <div className="px-6 py-5 bg-muted/10 border-t border-border/50">
                    {/* Legend */}
                    <div className="flex items-center gap-6 text-xs mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-destructive/30 border border-destructive/50" />
                        <span className="text-muted-foreground">Type Mismatch</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-warning/30 border border-warning/50" />
                        <span className="text-muted-foreground">Extra Field</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-muted border border-border" />
                        <span className="text-muted-foreground">Missing Field</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Expected */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20">
                            <Check className="h-3 w-3 text-primary" />
                          </div>
                          <span className="text-sm font-medium text-foreground">Expected (OpenAPI)</span>
                        </div>
                        <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                          {v.expected.map((item, i) => (
                            <div
                              key={i}
                              className={cn('px-2 py-0.5 rounded-sm', lineStyles[item.type])}
                            >
                              {item.line || '\u00A0'}
                            </div>
                          ))}
                        </pre>
                      </div>

                      {/* Received */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20">
                            <X className="h-3 w-3 text-warning" />
                          </div>
                          <span className="text-sm font-medium text-foreground">Received (Actual)</span>
                        </div>
                        <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                          {v.received.map((item, i) => (
                            <div
                              key={i}
                              className={cn('px-2 py-0.5 rounded-sm', lineStyles[item.type])}
                            >
                              {item.line || '\u00A0'}
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
