import type { ArticleListItem } from './content';

export interface InitialDataPayload {
  revision?: string;
  library?: {
    items?: ArticleListItem[];
    total?: number;
  };
}
