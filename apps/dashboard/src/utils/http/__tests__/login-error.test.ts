import { describe, it, expect } from 'vitest'
import { handleError } from '@/utils/http/error'
import { AxiosError } from 'axios'

describe('login error handling', () => {
  it('extracts backend error message on 401', () => {
    const fakeError = {
      response: {
        status: 401,
        data: { error: 'invalid credentials' },
      },
      message: 'Request failed with status code 401',
      config: { url: '/api/auth/user-login', method: 'POST' },
    } as unknown as AxiosError
    try {
      handleError(fakeError)
      expect.fail('should have thrown')
    } catch (e: any) {
      expect(e.message).toBe('invalid credentials')
      expect(e.code).toBe(401)
    }
  })
})
