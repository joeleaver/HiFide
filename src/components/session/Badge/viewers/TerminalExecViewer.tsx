import { Badge, Box, Code, Group, Stack, Text, ThemeIcon, ScrollArea, ActionIcon, CopyButton, Tooltip } from '@mantine/core';
import { IconCheck, IconX, IconTerminal2, IconCopy, IconCheck as IconCheckSmall } from '@tabler/icons-react';
import type { Badge as BadgeType } from '../../../../../electron/store/types';

interface TerminalExecData {
  command?: string;
  output?: string;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  lines?: number;
  truncated?: boolean;
  result?: {
    outputPreview?: string;
    fullOutputAvailable?: boolean;
  };
  cwd?: string;
}

interface TerminalExecViewerProps {
  badge: BadgeType;
}

export const TerminalExecViewer = ({ badge }: TerminalExecViewerProps) => {
  const data = (badge.result ?? {}) as TerminalExecData;
  
  // Safe extraction of exit code to handle legacy/malformed data
  // @ts-ignore
  const rawExitCode = data.exitCode;
  let safeExitCode: number | null | undefined;

  if (typeof rawExitCode === 'object' && rawExitCode !== null) {
    // Handle legacy case where exitCode was { exitCode: number }
    // @ts-ignore
    safeExitCode = rawExitCode.exitCode;
  } else {
    safeExitCode = rawExitCode;
  }

  const isSuccess = safeExitCode === 0;
  // Fallback to outputPreview if direct output is missing (common in toolResult structure)
  const output = data.output || data.result?.outputPreview || '';
  const isTruncated = data.truncated || data.result?.fullOutputAvailable;
  
  // Format duration
  const durationMs = data.durationMs ?? 0;
  const durationLabel = durationMs > 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`;

  return (
    <Stack gap="md" p="xs">
      <Group justify="space-between" align="start">
        <Group gap="sm">
          <ThemeIcon
            variant="light"
            color="blue"
            size="lg"
            radius="md"
          >
            <IconTerminal2 size={20} />
          </ThemeIcon>
          <Box>
             <Text size="sm" fw={600} c="bright">
              Terminal Execution
            </Text>
            {data.cwd && (
              <Text size="xs" c="dimmed" lineClamp={1} title={data.cwd}>
                {data.cwd}
              </Text>
            )}
          </Box>
        </Group>
        
        <Group gap="xs">
          {durationMs > 0 && (
            <Badge variant="light" color="gray" size="sm">
              {durationLabel}
            </Badge>
          )}
          {safeExitCode !== undefined && safeExitCode !== null && (
            <Badge
              variant="light"
              color={isSuccess ? 'green' : 'red'}
              size="sm"
              leftSection={isSuccess ? <IconCheck size={12} /> : <IconX size={12} />}
            >
              Exit {safeExitCode}
            </Badge>
          )}
           {data.timedOut && (
            <Badge variant="light" color="orange" size="sm">
              Timed Out
            </Badge>
          )}
        </Group>
      </Group>

      {data.command && (
        <Stack gap="xs">
          <Group justify="space-between">
             <Text size="xs" fw={700} tt="uppercase" c="dimmed">Command</Text>
             <CopyButton value={data.command} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy command'} withArrow position="right">
                  <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} size="xs">
                    {copied ? <IconCheckSmall size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Code 
            block 
            style={{ 
              wordBreak: 'break-all', 
              whiteSpace: 'pre-wrap',
              backgroundColor: 'var(--mantine-color-dark-6)',
              color: 'var(--mantine-color-gray-1)'
            }}
          >
            {data.command}
          </Code>
        </Stack>
      )}

      {output && (
        <Stack gap="xs">
          <Group justify="space-between">
             <Text size="xs" fw={700} tt="uppercase" c="dimmed">Output</Text>
             <CopyButton value={output} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy output'} withArrow position="right">
                  <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} size="xs">
                    {copied ? <IconCheckSmall size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <ScrollArea.Autosize mah={400} type="auto" offsetScrollbars>
             <Code 
              block 
              style={{ 
                whiteSpace: 'pre-wrap', 
                backgroundColor: 'var(--mantine-color-dark-8)',
                color: 'var(--mantine-color-gray-4)',
                fontFamily: 'monospace',
                fontSize: '0.85em'
              }}
            >
              {output}
            </Code>
          </ScrollArea.Autosize>
          {isTruncated && (
             <Text size="xs" c="dimmed" fs="italic" ta="right">
               * Output truncated. Full output available in logs.
             </Text>
          )}
        </Stack>
      )}
      
      {!data.command && !output && (
        <Text size="sm" c="dimmed" ta="center" fs="italic">
          No details available
        </Text>
      )}
    </Stack>
  );
};
