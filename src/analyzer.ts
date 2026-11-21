import { parse } from 'libpg-query';
import type { StructuralRisk } from './model.ts';

export const maxSqlBytes = 128 * 1024;
const assumptions = [
  'Production workload, data distribution, size, and concurrent sessions remain unverified.',
  'Application behavior and automated rollback require execution evidence and human review.',
  'A clean static analysis result provides no production safety guarantee.',
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export async function analyzeSql(sql: string) {
  if (sql.includes('\0') || Buffer.byteLength(sql) > maxSqlBytes) {
    throw new Error('SQL must be UTF-8 text of at most 128 KiB.');
  }
  let parsed: Awaited<ReturnType<typeof parse>>;
  try {
    parsed = await parse(sql);
  } catch {
    throw new Error('PostgreSQL could not parse the SQL file.');
  }
  const statements = parsed.stmts ?? [];
  if (statements.length === 0) throw new Error('SQL must contain at least one statement.');
  const risks: StructuralRisk[] = [];

  for (const [index, statement] of statements.entries()) {
    const add = (
      code: string, severity: StructuralRisk['severity'], explanation: string,
      category: StructuralRisk['category'] = 'structural-risk',
    ) => {
      if (!risks.some(risk => risk.statement === index + 1 && risk.code === code)) {
        risks.push({ code, severity, explanation, category, statement: index + 1 });
      }
    };
    const locking = () => add('LOCKING', 'medium', 'Confirm required locks and set bounded lock and statement timeouts.', 'potential-risk');
    const rollback = () => add('ROLLBACK_REVIEW', 'high', 'Confirm a recovery path that preserves affected data.', 'potential-risk');

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      for (const [key, inner] of Object.entries(object(value))) {
        const node = object(inner);
        switch (key) {
          case 'DropStmt':
            if (node.removeType === 'OBJECT_INDEX') {
              add('INDEX_DROP', 'high', 'Removing an index may change query plans or write behavior.');
            } else {
              add(node.removeType === 'OBJECT_TABLE' ? 'DROP_TABLE' : 'DROP_OBJECT', 'critical',
                'Removing a database object can destroy data or invalidate dependencies.');
              rollback();
            }
            locking();
            break;
          case 'RenameStmt':
            add('QUERY_COMPATIBILITY', 'high', 'Existing application queries may reference the previous identifier.', 'potential-risk');
            locking();
            break;
          case 'AlterTableCmd': {
            const action = String(node.subtype);
            if (action === 'AT_DropColumn') {
              add('DROP_COLUMN', 'critical', 'Dropping a populated column removes its stored values.');
              add('QUERY_COMPATIBILITY', 'high', 'Existing application queries may reference the removed column.', 'potential-risk');
              rollback();
            }
            if (/^AT_(DisableTrig|SetUnLogged|DropExpression)/.test(action)) {
              add('ALTER_BEHAVIOR', 'high', 'Review the effect of changing durability or removing automatic data behavior.', 'potential-risk');
              rollback();
            }
            if (action === 'AT_AlterColumnType') {
              add('TYPE_CONVERSION', 'high', 'Check cast behavior, possible table rewrites and application types.', 'potential-risk');
              rollback();
            }
            if (action === 'AT_SetNotNull') {
              add('NOT_NULL_VALIDATION', 'high', 'Existing NULL values violate the proposed constraint.');
            }
            if (/Constraint|NotNull/.test(action)) {
              add('CONSTRAINT_CHANGE', 'medium', 'Check existing rows and verify writes under the new constraint.');
              if (action.startsWith('AT_Drop')) rollback();
            }
            locking();
            break;
          }
          case 'IndexStmt':
            add('INDEX_CHANGE', 'medium', 'Inspect plans and DDL lock behavior on representative data.');
            if (node.unique) add('CONSTRAINT_CHANGE', 'medium', 'Check for conflicting values before building a unique index.');
            locking();
            break;
          case 'UpdateStmt':
            add('BACKFILL_VALIDATION', 'high', 'Verify affected rows, value mapping and restart behavior.', 'potential-risk');
            rollback();
            break;
          case 'DeleteStmt':
          case 'TruncateStmt':
            add('DATA_REMOVAL', 'critical', 'The statement can remove existing records.');
            rollback();
            locking();
            break;
          case 'VariableSetStmt':
            if (['lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout'].includes(String(node.name))
              || node.kind === 'VAR_RESET_ALL') {
              add('TIMEOUT_REVIEW', 'medium', 'Verify effective time limits after changing or resetting this session setting.', 'potential-risk');
            }
            break;
          case 'LockStmt':
          case 'ReindexStmt':
            locking();
            break;
        }
        visit(inner);
      }
    };
    visit(statement.stmt);
  }

  return { statementCount: statements.length, risks, unverifiedAssumptions: [...assumptions] };
}
