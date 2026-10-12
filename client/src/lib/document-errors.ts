export function documentUnavailableMessage(errorCode?: string): string {
  switch (errorCode) {
    case 'FEISHU_AUTH_NOT_CONFIGURED':
      return '阅读服务尚未配置飞书服务端凭证，请稍后重试。';
    case 'FEISHU_TOKEN_EXCHANGE_NETWORK_ERROR':
      return '阅读服务暂时无法连接飞书认证服务，请稍后重试。';
    case 'FEISHU_TOKEN_EXCHANGE_INVALID_RESPONSE':
      return '飞书认证服务返回了无法识别的结果，请稍后重试。';
    case 'INVALID_DOCUMENT_LINK':
    case 'FEISHU_WIKI_DOCUMENT_MISSING':
      return '这条同步记录暂时没有可读取的飞书文档。';
    default:
      if (
        errorCode?.startsWith('FEISHU_TOKEN_EXCHANGE_HTTP_') ||
        errorCode?.startsWith('FEISHU_TOKEN_EXCHANGE_API_')
      ) {
        return '飞书服务端凭证未通过校验，请检查 App ID、secret 及飞书应用权限。';
      }
      return '飞书正文暂时无法读取，请通过原文入口查看内容。稍后可以回到这里重试。';
  }
}
