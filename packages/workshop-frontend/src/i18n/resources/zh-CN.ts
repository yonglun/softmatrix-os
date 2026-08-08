import { PRODUCT_NAME } from "@gadgets/workshop-shared/product";
import type en from "./en";

const zhCN = {
  app: {
    name: PRODUCT_NAME,
    tagline: "安全地构建个人应用和智能体。",
  },
  common: {
    back: "返回",
    cancel: "取消",
    close: "关闭",
    create: "创建",
    delete: "删除",
    edit: "编辑",
    loading: "加载中…",
    next: "下一步",
    retry: "重试",
    save: "保存",
  },
  auth: {
    password: "密码",
    signIn: {
      submit: "登录",
      title: "登录",
    },
    signOut: "退出登录",
    username: "用户名",
  },
  errors: {
    generic: "出了点问题。",
    network: "网络错误，请重试。",
  },
  profile: {
    title: "个人资料",
  },
  admin: {
    title: "管理",
  },
  models: {
    title: "模型",
  },
  workspaces: {
    title: "工作区",
  },
  blueprints: {
    title: "蓝图",
  },
  connectors: {
    title: "连接器",
  },
  chat: {
    title: "聊天",
  },
  gadgets: {
    title: "Gadget",
  },
} satisfies typeof en;

export default zhCN;
