export interface DiffLine {
  type: 'match' | 'error' | 'warning' | 'missing';
  line: string;
}

export function computeJsonDiff(expected: any, received: any): { expected: DiffLine[], received: DiffLine[] } {
  const expectedStr = expected ? JSON.stringify(expected, null, 2) : '';
  const receivedStr = received ? JSON.stringify(received, null, 2) : '';

  const expectedLines = expectedStr ? expectedStr.split('\n') : [];
  const receivedLines = receivedStr ? receivedStr.split('\n') : [];

  // Strip trailing commas for comparison
  const normalize = (l: string) => l.trim().replace(/,$/, '');

  const expectedRes: DiffLine[] = expectedLines.map(line => {
    const norm = normalize(line);
    if (norm === '{' || norm === '}' || norm === '[' || norm === ']') return { type: 'match', line };
    const match = receivedLines.some(rl => normalize(rl) === norm);
    if (match) return { type: 'match', line };
    
    // If we have same key but different value
    const keyMatch = norm.match(/^"([^"]+)":/);
    if (keyMatch) {
       const hasKey = receivedLines.some(rl => normalize(rl).startsWith(`"${keyMatch[1]}":`));
       if (hasKey) return { type: 'error', line }; // Type mismatch
    }
    
    return { type: 'missing', line };
  });

  const receivedRes: DiffLine[] = receivedLines.map(line => {
    const norm = normalize(line);
    if (norm === '{' || norm === '}' || norm === '[' || norm === ']') return { type: 'match', line };
    const match = expectedLines.some(el => normalize(el) === norm);
    if (match) return { type: 'match', line };
    
    const keyMatch = norm.match(/^"([^"]+)":/);
    if (keyMatch) {
       const hasKey = expectedLines.some(el => normalize(el).startsWith(`"${keyMatch[1]}":`));
       if (hasKey) return { type: 'error', line }; // Type mismatch
    }
    
    // Extra field
    return { type: 'warning', line };
  });

  return { expected: expectedRes, received: receivedRes };
}
