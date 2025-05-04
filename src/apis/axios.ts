import axios, { type AxiosError, type AxiosResponse } from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_URL,
});

api.interceptors.response.use(
  <T>(response: AxiosResponse<T>): T => response.data,
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

export default api;
