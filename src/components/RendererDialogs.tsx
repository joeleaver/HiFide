import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import {
  acceptConfirmDialog,
  cancelConfirmDialog,
  cancelPromptDialog,
  submitPromptInput,
  useDialogStore,
} from '../store/dialogs'

const getDangerColor = () => '#ff5757'

const RendererDialogs = () => {
  const prompt = useDialogStore((s) => s.prompt)
  const confirm = useDialogStore((s) => s.confirm)
  const [promptValue, setPromptValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const promptId = prompt?.id
  useEffect(() => {
    if (!prompt) {
      setPromptValue('')
      return
    }
    setPromptValue(prompt.defaultValue ?? '')
    window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 15)
  }, [promptId, prompt])

  const confirmColor = useMemo(() => (confirm?.intent === 'danger' ? getDangerColor() : undefined), [confirm?.intent])

  const handlePromptSubmit = () => {
    const value = promptValue.trim()
    if (!value) {
      cancelPromptDialog()
      return
    }
    submitPromptInput(value)
  }

  return (
    <>
      <Modal
        opened={!!prompt}
        onClose={cancelPromptDialog}
        withCloseButton={false}
        centered
        title={prompt?.title}
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <Stack gap="md">
          {prompt?.message && <Text size="sm">{prompt.message}</Text>}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handlePromptSubmit()
            }}
          >
            <Stack gap="xs">
              <TextInput
                ref={inputRef}
                placeholder={prompt?.placeholder}
                value={promptValue}
                onChange={(event) => setPromptValue(event.currentTarget.value)}
                autoFocus
                data-autofocus
              />
              <Group justify="flex-end" gap="xs">
                <Button variant="default" onClick={cancelPromptDialog} size="xs">
                  {prompt?.cancelLabel || 'Cancel'}
                </Button>
                <Button type="submit" size="xs">
                  {prompt?.confirmLabel || 'OK'}
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Modal>

      <Modal
        opened={!!confirm}
        onClose={cancelConfirmDialog}
        withCloseButton={false}
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={confirm?.title}
      >
        <Stack gap="md">
          {confirm?.message && <Text size="sm">{confirm.message}</Text>}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={cancelConfirmDialog} size="xs">
              {confirm?.cancelLabel || 'Cancel'}
            </Button>
            <Button
              size="xs"
              style={confirmColor ? { backgroundColor: confirmColor, color: '#000' } : undefined}
              onClick={acceptConfirmDialog}
            >
              {confirm?.confirmLabel || 'Confirm'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

export default RendererDialogs
