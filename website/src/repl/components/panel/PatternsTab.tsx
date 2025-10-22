import {
  exportPatterns,
  importPatterns,
  loadAndSetFeaturedPatterns,
  loadAndSetPublicPatterns,
  patternFilterName,
  useActivePattern,
  useViewingPatternData,
  userPattern,
} from '../../../user_pattern_utils';
import { useMemo } from 'react';
import { getMetadata } from '../../../metadata_parser';
import { useExamplePatterns } from '../../useExamplePatterns';
import { parseJSON, isUdels } from '../../util';
import { useSettings } from '../../../settings';
import { ActionButton } from '../button/action-button';
import { Pagination } from '../pagination/Pagination';
import { useState } from 'react';
import { useDebounce } from '../usedebounce';
import cx from '@src/cx';
import { BurgerMenuButton } from '../ui/BurgerMenuButton';
import { 
  DocumentIcon, 
  PencilIcon, 
  TrashIcon, 
  DocumentDuplicateIcon,
  ArrowDownTrayIcon 
} from '@heroicons/react/24/outline';

interface Pattern {
  id: string;
  code: string;
  created_at: string;
  collection?: string;
}

interface ReplContext {
  started: boolean;
  handleUpdate: (data: any, reset?: boolean) => void;
}

interface PatternsTabProps {
  context: ReplContext;
}

interface PatternLabelProps {
  pattern: Pattern;
}

export function PatternLabel({ pattern }: PatternLabelProps) {
  const meta = useMemo(() => getMetadata(pattern.code), [pattern]);

  let title = meta.title;
  if (title == null) {
    const date = new Date(pattern.created_at);
    if (!isNaN(date.getTime())) {
      title = date.toLocaleDateString();
    } else {
      title = 'unnamed';
    }
  }

  const author = Array.isArray(meta.by) ? meta.by.join(',') : 'Anonymous';
  return <>{`${pattern.id}: ${title} by ${author.slice(0, 100)}`.slice(0, 60)}</>;
}

interface PatternButtonProps {
  showOutline: boolean;
  onClick: () => void;
  pattern: Pattern;
  showHiglight: boolean;
  isUserPattern?: boolean;
  context?: ReplContext;
}

function PatternButton({ showOutline, onClick, pattern, showHiglight, isUserPattern = false, context }: PatternButtonProps) {
  const getPatternContextItems = () => {
    const items = [
      {
        label: 'Load',
        icon: <DocumentIcon className="w-4 h-4" />,
        onClick: () => onClick(),
      }
    ];

    if (isUserPattern) {
      items.push(
        {
          label: 'Duplicate',
          icon: <DocumentDuplicateIcon className="w-4 h-4" />,
          onClick: () => {
            const { data } = userPattern.duplicate(pattern);
            if (context) {
              updateCodeWindow(context, data);
            }
          },
        },
        {
          label: 'Export',
          icon: <ArrowDownTrayIcon className="w-4 h-4" />,
          onClick: () => {
            const blob = new Blob([JSON.stringify({ [pattern.id]: pattern })], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pattern-${pattern.id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          },
        },
        { separator: true, label: '', onClick: () => {} },
        {
          label: 'Delete',
          icon: <TrashIcon className="w-4 h-4" />,
          onClick: () => {
            const { data } = userPattern.delete(pattern.id);
            if (context) {
              updateCodeWindow(context, { ...data, collection: userPattern.collection });
            }
          },
        }
      );
    }

    return items;
  };

  return (
    <div
      className={cx(
        'group mr-4 hover:opacity-50 cursor-pointer flex items-center justify-between',
        showOutline && 'outline outline-1',
        showHiglight && 'bg-selection',
      )}
    >
      <div onClick={onClick} className="flex-1">
        <PatternLabel pattern={pattern} />
      </div>
      {isUserPattern && (
        <div className="ml-2">
          <BurgerMenuButton
            items={getPatternContextItems()}
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

interface PatternButtonsProps {
  patterns: Record<string, Pattern>;
  activePattern: string;
  onClick: (id: string) => void;
  started: boolean;
  isUserPatterns?: boolean;
  context?: ReplContext;
}

function PatternButtons({ patterns, activePattern, onClick, started, isUserPatterns = false, context }: PatternButtonsProps) {
  const viewingPatternStore = useViewingPatternData();
  const viewingPatternData = parseJSON(viewingPatternStore);
  const viewingPatternID = viewingPatternData?.id;
  
  return (
    <div className="">
      {Object.values(patterns)
        .reverse()
        .map((pattern) => {
          const id = pattern.id;
          return (
            <PatternButton
              pattern={pattern}
              key={id}
              showHiglight={id === viewingPatternID}
              showOutline={id === activePattern && started}
              onClick={() => onClick(id)}
              isUserPattern={isUserPatterns}
              context={context}
            />
          );
        })}
    </div>
  );
}

const updateCodeWindow = (context: ReplContext, patternData: any, reset = false) => {
  context.handleUpdate(patternData, reset);
};

const autoResetPatternOnChange = !isUdels();

interface UserPatternsProps {
  context: ReplContext;
}

function UserPatterns({ context }: UserPatternsProps) {
  const activePattern = useActivePattern();
  const viewingPatternStore = useViewingPatternData();
  const viewingPatternData = parseJSON(viewingPatternStore);
  const { userPatterns, patternFilter } = useSettings();
  const viewingPatternID = viewingPatternData?.id;
  
  return (
    <div className="flex flex-col gap-2 flex-grow overflow-hidden h-full pb-2 ">
      <div className="pr-4 space-x-4  flex max-w-full overflow-x-auto">
        <ActionButton
          label="new"
          onClick={() => {
            const { data } = userPattern.createAndAddToDB();
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="duplicate"
          onClick={() => {
            const { data } = userPattern.duplicate(viewingPatternData);
            updateCodeWindow(context, data);
          }}
        />
        <ActionButton
          label="delete"
          onClick={() => {
            const { data } = userPattern.delete(viewingPatternID);
            updateCodeWindow(context, { ...data, collection: userPattern.collection });
          }}
        />
        <label className="hover:opacity-50 cursor-pointer">
          <input
            style={{ display: 'none' }}
            type="file"
            multiple
            accept="text/plain,text/x-markdown,application/json"
            onChange={(e) => importPatterns(e.target.files)}
          />
          import
        </label>
        <ActionButton label="export" onClick={exportPatterns} />

        <ActionButton
          label="delete-all"
          onClick={() => {
            const { data } = userPattern.clearAll();
            updateCodeWindow(context, data);
          }}
        />
      </div>

      <div className="overflow-auto h-full bg-background p-2 rounded-md">
        <PatternButtons
          onClick={(id) =>
            updateCodeWindow(
              context,
              { ...userPatterns[id], collection: userPattern.collection },
              autoResetPatternOnChange,
            )
          }
          patterns={userPatterns}
          started={context.started}
          activePattern={activePattern}
          isUserPatterns={true}
          context={context}
        />
      </div>
    </div>
  );
}

interface PatternPageWithPaginationProps {
  patterns: Record<string, Pattern>;
  patternOnClick: (id: string) => void;
  context: ReplContext;
  paginationOnChange: (page: number) => void;
  initialPage: number;
}

function PatternPageWithPagination({ 
  patterns, 
  patternOnClick, 
  context, 
  paginationOnChange, 
  initialPage 
}: PatternPageWithPaginationProps) {
  const [page, setPage] = useState(initialPage);
  const debouncedPageChange = useDebounce(() => {
    paginationOnChange(page);
  });

  const onPageChange = (pageNum: number) => {
    setPage(pageNum);
    debouncedPageChange();
  };

  const activePattern = useActivePattern();
  return (
    <div className="flex flex-grow flex-col  h-full overflow-hidden justify-between">
      <div className="overflow-auto flex flex-col flex-grow bg-background p-2 rounded-md ">
        <PatternButtons
          onClick={(id) => patternOnClick(id)}
          started={context.started}
          patterns={patterns}
          activePattern={activePattern}
          isUserPatterns={false}
          context={context}
        />
      </div>
      <div className="flex items-center gap-2 py-2">
        <label htmlFor="pattern pagination">Page</label>
        <Pagination id="pattern pagination" currPage={page} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

let featuredPageNum = 1;

interface FeaturedPatternsProps {
  context: ReplContext;
}

function FeaturedPatterns({ context }: FeaturedPatternsProps) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.featured);
  
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={featuredPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(
          context,
          { ...patterns[id], collection: patternFilterName.featured },
          autoResetPatternOnChange,
        );
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetFeaturedPatterns(pageNum - 1);
        featuredPageNum = pageNum;
      }}
    />
  );
}

let latestPageNum = 1;

interface LatestPatternsProps {
  context: ReplContext;
}

function LatestPatterns({ context }: LatestPatternsProps) {
  const examplePatterns = useExamplePatterns();
  const collections = examplePatterns.collections;
  const patterns = collections.get(patternFilterName.public);
  
  return (
    <PatternPageWithPagination
      patterns={patterns}
      context={context}
      initialPage={latestPageNum}
      patternOnClick={(id) => {
        updateCodeWindow(context, { ...patterns[id], collection: patternFilterName.public }, autoResetPatternOnChange);
      }}
      paginationOnChange={async (pageNum) => {
        await loadAndSetPublicPatterns(pageNum - 1);
        latestPageNum = pageNum;
      }}
    />
  );
}

interface PublicPatternsProps {
  context: ReplContext;
}

function PublicPatterns({ context }: PublicPatternsProps) {
  const { patternFilter } = useSettings();
  if (patternFilter === patternFilterName.featured) {
    return <FeaturedPatterns context={context} />;
  }
  return <LatestPatterns context={context} />;
}

export function PatternsTab({ context }: PatternsTabProps) {
  const { patternFilter } = useSettings();

  return (
    <div className="px-4 w-full text-foreground  space-y-2  flex flex-col overflow-hidden max-h-full h-full">
      <UserPatterns context={context} />
    </div>
  );
}