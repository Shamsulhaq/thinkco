/** use_aws: a thin, validated wrapper over the AWS CLI for read/admin operations. */
import { z } from 'zod';
import { execFile } from 'node:child_process';
import type { Tool, ToolContext } from '../types.js';

const schema = z.object({
  service_name: z.string().describe('AWS service, e.g. "s3api", "ec2", "dynamodb"'),
  operation_name: z.string().describe('Operation, e.g. "ListBuckets" or "describe-instances"'),
  region: z.string().describe('AWS region, e.g. "us-east-1"'),
  parameters: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
    .optional()
    .describe('Operation parameters as key/value pairs (kebab-case keys)'),
  profile_name: z.string().optional().describe('AWS profile to use'),
  label: z.string().optional().describe('Human-readable description of the call'),
});

type AwsInput = z.infer<typeof schema>;

/** PascalCase / camelCase operation name -> kebab-case AWS CLI command. */
function toKebab(op: string): string {
  if (op.includes('-')) return op; // already kebab
  return op.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();
}

function buildArgs(input: AwsInput): string[] {
  const args = [input.service_name, toKebab(input.operation_name), '--region', input.region];
  if (input.profile_name) args.push('--profile', input.profile_name);
  for (const [key, value] of Object.entries(input.parameters ?? {})) {
    const flag = `--${toKebab(key)}`;
    if (value === true) {
      args.push(flag);
    } else if (value === false || value === null) {
      // skip falsy flags / null values
    } else if (Array.isArray(value)) {
      args.push(flag, ...value.map(String));
    } else {
      args.push(flag, String(value));
    }
  }
  return args;
}

export const useAwsTool: Tool<AwsInput> = {
  name: 'use_aws',
  description:
    'Run an AWS CLI operation. Provide service_name, operation_name (PascalCase or kebab-case), ' +
    'region, and optional parameters/profile. Requires the AWS CLI to be installed and configured.',
  risk: 'network',
  schema,
  run: (input, ctx: ToolContext) =>
    new Promise<string>((resolvePromise) => {
      const args = buildArgs(input);
      execFile(
        'aws',
        args,
        { cwd: ctx.cwd, signal: ctx.signal, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            resolvePromise('AWS CLI not found. Install it (https://aws.amazon.com/cli/) and run `aws configure`.');
            return;
          }
          const out = `${stdout}${stderr}`.trim();
          if (err && !out) {
            resolvePromise(`aws ${args.join(' ')} failed: ${err.message}`);
            return;
          }
          resolvePromise(out || '(no output)');
        },
      );
    }),
};
