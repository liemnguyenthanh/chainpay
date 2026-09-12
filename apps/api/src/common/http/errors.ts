import { HttpException } from '@nestjs/common';
export const fail = (status: number, code: string, message: string): never => {
  throw new HttpException({ code, message }, status);
};
