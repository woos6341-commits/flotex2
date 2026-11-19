import { HttpError } from "../../shared/_core/errors";

export function isInvalidAuthentication(error: unknown): boolean {
  return error instanceof HttpError && (error.statusCode === 401 || error.statusCode === 403);
}
export function authenticationUnavailable() {
  return new HttpError(503, "تعذر التحقق من الجلسة مؤقتًا. حسابك لم يُسجّل الخروج؛ تحقق من الاتصال وحاول مجددًا.");
}
